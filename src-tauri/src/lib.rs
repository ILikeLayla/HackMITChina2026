// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use chrono::{DateTime, Local};
use reqwest::Client;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

const GOOGLE_WORKER_OAUTH_START_URL: &str = "https://layla-calendar-oauth.2031683205.workers.dev/oauth/google/start";

#[derive(serde::Serialize, serde::Deserialize)]
struct GoogleCalendarListItem {
    id: Option<String>,
    summary: Option<String>,
    #[serde(rename = "accessRole")]
    access_role: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct GoogleCalendarListResponse {
    items: Option<Vec<GoogleCalendarListItem>>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarSelectionItem {
    id: String,
    name: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarSyncSession {
    access_token: String,
    calendars: Vec<GoogleCalendarSelectionItem>,
}

#[derive(Default)]
struct GoogleSyncState {
    canceled_request_ids: Mutex<HashSet<String>>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct GoogleCalendarEventStart {
    date: Option<String>,
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct GoogleCalendarEvent {
    id: Option<String>,
    status: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    start: Option<GoogleCalendarEventStart>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct GoogleCalendarEventsResponse {
    items: Option<Vec<GoogleCalendarEvent>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarNormalizedEvent {
    event_key: String,
    title: String,
    date: String,
    time: String,
    note: String,
}

fn receive_oauth_access_token(listener: TcpListener) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to set listener non-blocking mode: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _addr)) => {
                let mut request_buf = [0u8; 8192];
                let read_len = stream
                    .read(&mut request_buf)
                    .map_err(|e| format!("Failed to read OAuth callback request: {e}"))?;
                let request_text = String::from_utf8_lossy(&request_buf[..read_len]);
                let request_line = request_text.lines().next().unwrap_or_default();
                let path_with_query = request_line
                    .split_whitespace()
                    .nth(1)
                    .ok_or_else(|| "Malformed OAuth callback HTTP request.".to_string())?;

                let parsed = Url::parse(&format!("http://localhost{}", path_with_query))
                    .map_err(|e| format!("Failed to parse OAuth callback URL: {e}"))?;

                let access_token = parsed
                    .query_pairs()
                    .find(|(k, _)| k == "access_token")
                    .map(|(_, v)| v.to_string());
                let oauth_error = parsed
                    .query_pairs()
                    .find(|(k, _)| k == "error")
                    .map(|(_, v)| v.to_string());
                let oauth_message = parsed
                    .query_pairs()
                    .find(|(k, _)| k == "message")
                    .map(|(_, v)| v.to_string());

                let response_body = if access_token.is_some() {
                    "Google authorization completed. You can close this window and return to the app."
                } else {
                    "Google authorization failed or was canceled. You can close this window and return to the app."
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                if let Some(err) = oauth_error {
                    let message = oauth_message.unwrap_or_default();
                    if message.is_empty() {
                        return Err(format!("Google OAuth returned an error: {err}"));
                    }
                    return Err(format!("Google OAuth returned an error: {err} ({message})"));
                }

                if let Some(access_token) = access_token {
                    return Ok(access_token);
                }

                return Err("OAuth callback did not include access_token from Worker handoff.".to_string());
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(60));
            }
            Err(err) => {
                return Err(format!("OAuth loopback listener failed while waiting for callback: {err}"));
            }
        }
    }

    Err("Timed out waiting for Google OAuth callback.".to_string())
}

fn parse_date_time_to_local(date_time: &str) -> Option<(String, String)> {
    let parsed = DateTime::parse_from_rfc3339(date_time).ok()?;
    let local_time: DateTime<Local> = parsed.with_timezone(&Local);
    Some((
        local_time.format("%Y-%m-%d").to_string(),
        local_time.format("%H:%M").to_string(),
    ))
}

fn build_event_note(event: &GoogleCalendarEvent, calendar_name: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(description) = event.description.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
        parts.push(description.to_string());
    }
    if let Some(location) = event.location.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
        parts.push(format!("Location: {location}"));
    }
    parts.push(format!("Imported from Google Calendar ({calendar_name})"));
    parts.join("\n\n")
}

async fn fetch_google_events_for_calendar(
    http_client: &Client,
    access_token: &str,
    calendar_id: &str,
    calendar_name: &str,
    time_min: &str,
    time_max: &str,
    sync_state: &GoogleSyncState,
    sync_request_id: &str,
) -> Result<Vec<GoogleCalendarNormalizedEvent>, String> {
    let mut all_events: Vec<GoogleCalendarNormalizedEvent> = Vec::new();
    let mut next_page_token: Option<String> = None;

    loop {
        if is_google_sync_canceled(sync_state, sync_request_id)? {
            return Err("Google Calendar sync canceled by user.".to_string());
        }

        let mut url = Url::parse(&format!(
            "https://www.googleapis.com/calendar/v3/calendars/{}/events",
            urlencoding::encode(calendar_id),
        ))
        .map_err(|e| format!("Failed to compose Google Calendar events URL: {e}"))?;

        {
            let mut query = url.query_pairs_mut();
            query.append_pair("singleEvents", "true");
            query.append_pair("orderBy", "startTime");
            query.append_pair("maxResults", "2500");
            query.append_pair("timeMin", time_min);
            query.append_pair("timeMax", time_max);
            if let Some(page_token) = &next_page_token {
                query.append_pair("pageToken", page_token);
            }
        }

        let response = http_client
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| format!("Google Calendar events request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Google Calendar events request failed ({status}): {body}"));
        }

        let payload: GoogleCalendarEventsResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to decode Google Calendar events response: {e}"))?;

        for event in payload.items.unwrap_or_default() {
            if event.status.as_deref() == Some("cancelled") {
                continue;
            }

            let event_id = match event.id.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
                Some(value) => value,
                None => continue,
            };

            let (date, time) = match event.start.as_ref() {
                Some(start) => {
                    if let Some(all_day) = start.date.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
                        (all_day.to_string(), "00:00".to_string())
                    } else if let Some(date_time) = start.date_time.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
                        parse_date_time_to_local(date_time)
                            .unwrap_or_else(|| (date_time.chars().take(10).collect::<String>(), "00:00".to_string()))
                    } else {
                        continue;
                    }
                }
                None => continue,
            };

            all_events.push(GoogleCalendarNormalizedEvent {
                event_key: format!("{}:{}", calendar_id, event_id),
                title: event
                    .summary
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .unwrap_or("(No title)")
                    .to_string(),
                date,
                time,
                note: build_event_note(&event, calendar_name),
            });
        }

        match payload.next_page_token {
            Some(token) if !token.is_empty() => {
                next_page_token = Some(token);
            }
            _ => break,
        }
    }

    Ok(all_events)
}

fn is_google_sync_canceled(sync_state: &GoogleSyncState, sync_request_id: &str) -> Result<bool, String> {
    let canceled = sync_state
        .canceled_request_ids
        .lock()
        .map_err(|_| "Google sync cancellation state poisoned.".to_string())?;
    Ok(canceled.contains(sync_request_id))
}

#[tauri::command]
fn cancel_google_calendar_sync(
    sync_request_id: String,
    sync_state: tauri::State<'_, GoogleSyncState>,
) -> Result<(), String> {
    let normalized = sync_request_id.trim();
    if normalized.is_empty() {
        return Err("sync_request_id is required to cancel Google sync.".to_string());
    }

    let mut canceled = sync_state
        .canceled_request_ids
        .lock()
        .map_err(|_| "Google sync cancellation state poisoned.".to_string())?;
    canceled.insert(normalized.to_string());
    Ok(())
}

#[tauri::command]
async fn begin_google_calendar_sync() -> Result<GoogleCalendarSyncSession, String> {
    let oauth_listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local OAuth callback listener: {e}"))?;
    let port = oauth_listener
        .local_addr()
        .map_err(|e| format!("Failed to resolve local OAuth callback port: {e}"))?
        .port();

    let return_to = format!("http://127.0.0.1:{port}/oauth-worker-callback");
    let mut worker_start_url = Url::parse(GOOGLE_WORKER_OAUTH_START_URL)
        .map_err(|e| format!("Failed to compose Worker OAuth start URL: {e}"))?;
    worker_start_url
        .query_pairs_mut()
        .append_pair("return_to", &return_to);

    let (oauth_result_tx, oauth_result_rx) = mpsc::channel::<Result<String, String>>();
    thread::spawn(move || {
        let result = receive_oauth_access_token(oauth_listener);
        let _ = oauth_result_tx.send(result);
    });

    open::that(worker_start_url.as_str())
        .map_err(|e| format!("Failed to open browser for Worker OAuth start URL: {e}"))?;

    let access_token = oauth_result_rx
        .recv_timeout(Duration::from_secs(190))
        .map_err(|_| "Timed out waiting for OAuth callback result from local listener thread.".to_string())??;

    let http_client = Client::new();
    let calendars_response = http_client
        .get("https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Google Calendar list request failed: {e}"))?;

    if !calendars_response.status().is_success() {
        let status = calendars_response.status();
        let body = calendars_response.text().await.unwrap_or_default();
        return Err(format!("Google Calendar list request failed ({status}): {body}"));
    }

    let calendar_list: GoogleCalendarListResponse = calendars_response
        .json()
        .await
        .map_err(|e| format!("Failed to decode calendar list response: {e}"))?;

    let calendars = calendar_list
        .items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|calendar| {
            let calendar_id = calendar
                .id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string)?;

            if calendar.access_role.as_deref() == Some("none") {
                return None;
            }

            let calendar_name = calendar
                .summary
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .unwrap_or("Unnamed calendar")
                .to_string();

            Some(GoogleCalendarSelectionItem {
                id: calendar_id,
                name: calendar_name,
            })
        })
        .collect();

    Ok(GoogleCalendarSyncSession {
        access_token,
        calendars,
    })
}

#[tauri::command]
async fn sync_google_calendar_events(
    access_token: String,
    selected_calendar_ids: Vec<String>,
    sync_request_id: String,
    sync_state: tauri::State<'_, GoogleSyncState>,
) -> Result<Vec<GoogleCalendarNormalizedEvent>, String> {
    let normalized_sync_request_id = sync_request_id.trim();
    if normalized_sync_request_id.is_empty() {
        return Err("sync_request_id is required for Google sync.".to_string());
    }

    {
        let mut canceled = sync_state
            .canceled_request_ids
            .lock()
            .map_err(|_| "Google sync cancellation state poisoned.".to_string())?;
        canceled.remove(normalized_sync_request_id);
    }

    let run_result = async {
        let selected_ids: HashSet<String> = selected_calendar_ids
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();

        if selected_ids.is_empty() {
            return Ok(Vec::new());
        }

        let http_client = Client::new();
        let now = chrono::Utc::now();
        let time_min = (now - chrono::Duration::days(180)).to_rfc3339();
        let time_max = (now + chrono::Duration::days(365)).to_rfc3339();

        let calendars_response = http_client
            .get("https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false")
            .bearer_auth(&access_token)
            .send()
            .await
            .map_err(|e| format!("Google Calendar list request failed: {e}"))?;

        if !calendars_response.status().is_success() {
            let status = calendars_response.status();
            let body = calendars_response.text().await.unwrap_or_default();
            return Err(format!("Google Calendar list request failed ({status}): {body}"));
        }

        let calendar_list: GoogleCalendarListResponse = calendars_response
            .json()
            .await
            .map_err(|e| format!("Failed to decode calendar list response: {e}"))?;

        let mut merged_events: Vec<GoogleCalendarNormalizedEvent> = Vec::new();
        for calendar in calendar_list.items.unwrap_or_default() {
            if is_google_sync_canceled(&sync_state, normalized_sync_request_id)? {
                return Err("Google Calendar sync canceled by user.".to_string());
            }

            let calendar_id = match calendar.id.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
                Some(value) => value,
                None => continue,
            };

            if !selected_ids.contains(calendar_id) {
                continue;
            }

            if calendar.access_role.as_deref() == Some("none") {
                continue;
            }

            let calendar_name = calendar
                .summary
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .unwrap_or("Unnamed calendar");

            let mut events = fetch_google_events_for_calendar(
                &http_client,
                &access_token,
                calendar_id,
                calendar_name,
                &time_min,
                &time_max,
                &sync_state,
                normalized_sync_request_id,
            )
            .await?;
            merged_events.append(&mut events);
        }

        Ok(merged_events)
    }
    .await;

    {
        let mut canceled = sync_state
            .canceled_request_ids
            .lock()
            .map_err(|_| "Google sync cancellation state poisoned.".to_string())?;
        canceled.remove(normalized_sync_request_id);
    }

    run_result
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
        .manage(GoogleSyncState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_events,
            begin_google_calendar_sync,
            sync_google_calendar_events,
            cancel_google_calendar_sync,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
