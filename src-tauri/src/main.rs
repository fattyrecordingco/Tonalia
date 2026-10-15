#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod audio;
mod collaboration;
mod media;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, State};
use tonalia_core::{encode_float, float_wav_header, validate_layers, Layer};
static IDS: AtomicU64 = AtomicU64::new(1);
struct ExportControl {
    cancel: Arc<AtomicBool>,
    completed: Arc<AtomicBool>,
}
#[derive(Default)]
struct AppState {
    sources: Mutex<HashMap<String, Arc<media::Source>>>,
    playback: Mutex<Option<Arc<audio::Playback>>>,
    export: Mutex<Option<ExportControl>>,
    launch: Mutex<Option<Result<SourceRef, String>>>,
    installation_report: Option<PathBuf>,
    host: Mutex<Option<collaboration::Host>>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceRef {
    kind: &'static str,
    id: String,
    name: String,
    size: u64,
}
fn source(state: &AppState, id: &str) -> Result<Arc<media::Source>, String> {
    state
        .sources
        .lock()
        .map_err(|_| "Source registry unavailable")?
        .get(id)
        .cloned()
        .ok_or("The source is no longer open.".into())
}
#[tauri::command]
fn open_source(path: String, state: State<AppState>) -> Result<SourceRef, String> {
    let input = Arc::new(media::Source::open(PathBuf::from(path))?);
    let id = IDS.fetch_add(1, Ordering::Relaxed).to_string();
    let result = SourceRef {
        kind: "native",
        id: id.clone(),
        name: input
            .path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        size: input.size,
    };
    let mut sources = state
        .sources
        .lock()
        .map_err(|_| "Source registry unavailable")?;
    sources.insert(id, input);
    Ok(result)
}
#[tauri::command]
fn release_source(id: String, state: State<AppState>) -> Result<(), String> {
    state
        .sources
        .lock()
        .map_err(|_| "Source registry unavailable")?
        .remove(&id);
    Ok(())
}
#[tauri::command]
async fn read_source_range(
    id: String,
    offset: u64,
    length: usize,
    state: State<'_, AppState>,
) -> Result<tauri::ipc::Response, String> {
    let s = source(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        s.bytes(offset, length).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn stop_audio(state: State<AppState>) -> Result<(), String> {
    if let Some(p) = state
        .playback
        .lock()
        .map_err(|_| "Audio control unavailable")?
        .take()
    {
        p.stop.store(true, Ordering::Release);
    }
    Ok(())
}
#[tauri::command]
fn set_volume(volume: f32, state: State<AppState>) -> Result<(), String> {
    if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
        return Err("Invalid monitor level".into());
    }
    if let Some(p) = state
        .playback
        .lock()
        .map_err(|_| "Audio control unavailable")?
        .as_ref()
    {
        p.volume.store(volume.to_bits(), Ordering::Relaxed);
    }
    Ok(())
}
#[tauri::command]
async fn play_audio(
    id: String,
    request: audio::PlayRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<audio::DeviceInfo, String> {
    let s = source(&state, &id)?;
    validate_layers(
        &request.layers,
        s.info.frames,
        s.info.sample_rate,
        s.info.channels,
    )?;
    if request.position >= request.end
        || request.end > s.info.frames
        || !request.volume.is_finite()
        || !(0.0..=1.0).contains(&request.volume)
        || !["original", "result", "removed"].contains(&request.mode.as_str())
    {
        return Err("Invalid playback range or monitor mode".into());
    }
    let ctrl = Arc::new(audio::Playback::new(request.volume));
    {
        let mut current = state
            .playback
            .lock()
            .map_err(|_| "Audio control unavailable")?;
        if let Some(old) = current.replace(ctrl.clone()) {
            old.stop.store(true, Ordering::Release);
        }
    }
    tauri::async_runtime::spawn_blocking(move || audio::start(app, s, request, ctrl))
        .await
        .map_err(|e| e.to_string())?
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    path: String,
    layers: Vec<Layer>,
    start: u64,
    end: u64,
    bits: u16,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    frames: u64,
    peak: f64,
}
fn reject_source_output(output: &PathBuf, input: &PathBuf) -> Result<(), String> {
    let same = if output.exists() {
        fs::canonicalize(output)
            .ok()
            .zip(fs::canonicalize(input).ok())
            .is_some_and(|(a, b)| {
                a.to_string_lossy()
                    .eq_ignore_ascii_case(&b.to_string_lossy())
            })
    } else {
        false
    };
    if same {
        return Err(
            "Tonalia never overwrites the source audio. Choose a different output file.".into(),
        );
    }
    Ok(())
}
#[tauri::command]
async fn export_audio(
    id: String,
    request: ExportRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportResult, String> {
    let s = source(&state, &id)?;
    validate_layers(
        &request.layers,
        s.info.frames,
        s.info.sample_rate,
        s.info.channels,
    )?;
    if request.start >= request.end
        || request.end > s.info.frames
        || ![32, 64].contains(&request.bits)
    {
        return Err("Invalid export range or precision".into());
    }
    let destination = PathBuf::from(&request.path);
    reject_source_output(&destination, &s.path)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let completed = Arc::new(AtomicBool::new(false));
    {
        let mut active = state
            .export
            .lock()
            .map_err(|_| "Export control unavailable")?;
        if active
            .as_ref()
            .is_some_and(|v| !v.completed.load(Ordering::Acquire))
        {
            return Err("An export is already running.".into());
        }
        *active = Some(ExportControl {
            cancel: cancel.clone(),
            completed: completed.clone(),
        });
    }
    tauri::async_runtime::spawn_blocking(move || {
        let temp = destination.with_file_name(format!(
            ".tonalia-{}-{}.tmp",
            std::process::id(),
            IDS.fetch_add(1, Ordering::Relaxed)
        ));
        let result = (|| -> Result<ExportResult, String> {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|e| format!("Cannot create export: {e}"))?;
            output
                .write_all(&float_wav_header(
                    s.info.sample_rate,
                    s.info.channels,
                    request.end - request.start,
                    request.bits,
                )?)
                .map_err(|e| e.to_string())?;
            let mut peak = 0f64;
            for start in (request.start..request.end).step_by(32768) {
                if cancel.load(Ordering::Acquire) {
                    return Err("Export cancelled; destination was not replaced.".into());
                }
                let end = (start + 32768).min(request.end);
                let pcm = s.render(start, end, &request.layers)?;
                for &v in &pcm {
                    peak = peak.max(v.abs());
                }
                output
                    .write_all(&encode_float(&pcm, request.bits)?)
                    .map_err(|e| format!("Export write failed: {e}"))?;
                let _ = app.emit(
                    "export-progress",
                    (end - request.start) as f64 / (request.end - request.start) as f64,
                );
            }
            if cancel.load(Ordering::Acquire) {
                return Err("Export cancelled; destination was not replaced.".into());
            }
            output.sync_all().map_err(|e| e.to_string())?;
            drop(output);
            reject_source_output(&destination, &s.path)?;
            fs::rename(&temp, &destination).map_err(|e| format!("Cannot finalize export: {e}"))?;
            Ok(ExportResult {
                frames: request.end - request.start,
                peak,
            })
        })();
        completed.store(true, Ordering::Release);
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn cancel_export(state: State<AppState>) -> Result<(), String> {
    if let Some(c) = state
        .export
        .lock()
        .map_err(|_| "Export control unavailable")?
        .as_ref()
    {
        c.cancel.store(true, Ordering::Release);
    }
    Ok(())
}
#[tauri::command]
fn save_project(path: String, contents: String, state: State<AppState>) -> Result<(), String> {
    if contents.len() > 4 * 1024 * 1024 {
        return Err("Project manifest exceeds 4 MiB".into());
    }
    let json: serde_json::Value = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    if json.get("format").and_then(|v| v.as_str()) != Some("tonalia") {
        return Err("Invalid Tonalia project".into());
    }
    let destination = PathBuf::from(path);
    for input in state
        .sources
        .lock()
        .map_err(|_| "Source registry unavailable")?
        .values()
    {
        reject_source_output(&destination, &input.path)?;
    }
    let temporary = destination.with_file_name(format!(
        ".tonalia-project-{}-{}.tmp",
        std::process::id(),
        IDS.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, &destination).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
#[tauri::command]
fn read_project(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 4 * 1024 * 1024 {
        return Err("Project manifest exceeds 4 MiB".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}
#[tauri::command]
fn take_launch_source(state: State<AppState>) -> Result<Option<SourceRef>, String> {
    state
        .launch
        .lock()
        .map_err(|_| "Launch source unavailable")?
        .take()
        .transpose()
}
// Opt-in packaging diagnostics: callers cannot choose a report path through IPC.
// The path is supplied by the person launching --installation-check, never by media.
#[tauri::command]
fn installation_check_enabled(state: State<AppState>) -> bool {
    state.installation_report.is_some()
}
#[tauri::command]
fn finish_installation_check(
    report: serde_json::Value,
    state: State<AppState>,
) -> Result<(), String> {
    let path = state
        .installation_report
        .as_ref()
        .ok_or("Installation diagnostics were not requested.")?;
    let contents = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
    if contents.len() > 65536 {
        return Err("Installation report is too large.".into());
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    output.write_all(&contents).map_err(|e| e.to_string())?;
    output.sync_all().map_err(|e| e.to_string())
}
#[tauri::command]
fn host_session(
    identity: collaboration::Identity,
    layers: Vec<Layer>,
    lan: bool,
    state: State<AppState>,
) -> Result<collaboration::Started, String> {
    let (host, started) = collaboration::start(identity, layers, lan)?;
    *state.host.lock().map_err(|_| "Session state unavailable")? = Some(host);
    Ok(started)
}
#[tauri::command]
fn stop_session(state: State<AppState>) -> Result<(), String> {
    state
        .host
        .lock()
        .map_err(|_| "Session state unavailable")?
        .take();
    Ok(())
}
#[tauri::command]
async fn exchange_session(
    endpoint: String,
    request: collaboration::Request,
) -> Result<collaboration::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || collaboration::exchange(endpoint, request))
        .await
        .map_err(|e| e.to_string())?
}
fn main() {
    let mut state = AppState::default();
    let arguments: Vec<_> = std::env::args_os().collect();
    if arguments
        .get(1)
        .is_some_and(|v| v == "--installation-check")
    {
        state.installation_report = arguments.get(2).map(PathBuf::from);
    }
    if let Some(path) = std::env::args_os()
        .nth(1)
        .filter(|p| !p.to_string_lossy().starts_with("--"))
    {
        let opened = media::Source::open(PathBuf::from(path)).map(|input| {
            let id = IDS.fetch_add(1, Ordering::Relaxed).to_string();
            let result = SourceRef {
                kind: "native",
                id: id.clone(),
                name: input
                    .path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                size: input.size,
            };
            state
                .sources
                .lock()
                .expect("Fresh source registry")
                .insert(id, Arc::new(input));
            result
        });
        *state.launch.lock().expect("Fresh launch registry") = Some(opened);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            host_session,
            stop_session,
            exchange_session,
            take_launch_source,
            installation_check_enabled,
            finish_installation_check,
            open_source,
            read_source_range,
            release_source,
            play_audio,
            stop_audio,
            set_volume,
            export_audio,
            cancel_export,
            save_project,
            read_project
        ])
        .run(tauri::generate_context!())
        .expect("Tonalia desktop startup failed");
}
