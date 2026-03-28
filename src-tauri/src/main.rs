// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::Command;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

fn resolve_python_paths() -> (PathBuf, PathBuf) {
    let dev_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("Failed to resolve project root")
        .to_path_buf();

    let mut candidate_bases: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidate_bases.push(exe_dir.join("resources"));
            candidate_bases.push(exe_dir.to_path_buf());
        }
    }
    candidate_bases.push(dev_base.clone());

    let base = candidate_bases
        .into_iter()
        .find(|base| base.join("src-python").join("langchain-server.py").exists())
        .unwrap_or(dev_base);

    (
        base.join("src-python")
            .join(".venv")
            .join("Scripts")
            .join("python.exe"),
        base.join("src-python").join("langchain-server.py"),
    )
}

fn spawn_python_server() -> Result<(), String> {
    let (python_exe, server_script) = resolve_python_paths();

    if !python_exe.exists() {
        return Err(format!("python.exe not found: {}", python_exe.display()));
    }
    if !server_script.exists() {
        return Err(format!("server script not found: {}", server_script.display()));
    }

    #[cfg(windows)]
    {
        // Use `start` + `cmd /C` so the console closes when python exits.
        return Command::new("cmd")
            .args([
                "/C",
                "start",
                "",
                "cmd",
                "/C",
            ])
            .arg(&python_exe)
            .arg(&server_script)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to start Python server: {e}"));
    }
}

fn wait_for_server_ready(timeout: Duration, poll_interval: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let addr: SocketAddr = "127.0.0.1:8766"
        .parse()
        .expect("Invalid server address");

    while Instant::now() < deadline {
        if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));

            let request = b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
            if stream.write_all(request).is_ok() {
                let mut response = [0u8; 128];
                if let Ok(read_len) = stream.read(&mut response) {
                    if read_len > 0 {
                        let head = String::from_utf8_lossy(&response[..read_len]);
                        if head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200") {
                            return true;
                        }
                    }
                }
            }
        }
        thread::sleep(poll_interval);
    }

    false
}

fn main() {
    if let Err(err) = spawn_python_server() {
        eprintln!("{err}");
    } else {
        let ready = wait_for_server_ready(
            Duration::from_secs(10),
            Duration::from_millis(200),
        );
        if !ready {
            eprintln!("Python server did not become ready within timeout");
        }
    }
    layla_calendar_lib::run()
}
