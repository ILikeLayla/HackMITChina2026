// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TimeStamp {
    date: Date,
    time: Time,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Date {
    year: u16,
    month: u8,
    day: u8,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Time {
    hour: u8,
    minute: u8,
}


#[derive(serde::Serialize, serde::Deserialize)]
pub struct Event {
    name: String,
    start: TimeStamp,
    end: TimeStamp,
    description: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Task {
    name: String,
    deadline: TimeStamp,
    description: String,
}

#[tauri::command]
fn get_events() -> Vec<Event> {
    let events = vec![
        Event {
            name: "Event 1".to_string(),
            start: TimeStamp {
                date: Date {
                    year: 2026,
                    month: 1,
                    day: 15,
                },
                time: Time {
                    hour: 10,
                    minute: 0,
                },
            },
            end: TimeStamp {
                date: Date {
                    year: 2026,
                    month: 3,
                    day: 15,
                },
                time: Time {
                    hour: 12,
                    minute: 0,
                },
            },
            description: "Event 1 description".to_string(),
        },
    ];
    events
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_events])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
