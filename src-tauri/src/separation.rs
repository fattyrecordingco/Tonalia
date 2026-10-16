//! Supervised local model jobs. The webview never supplies a command or executable.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::Emitter;

#[derive(Default)]
pub struct Jobs {
    pub current: Mutex<Option<Arc<Control>>>,
}
pub struct Control {
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
}
impl Control {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                let pid = child.id().to_string();
                #[cfg(windows)]
                {
                    let _ = quiet("taskkill").args(["/PID", &pid, "/T", "/F"]).output();
                }
                #[cfg(unix)]
                {
                    let _ = quiet("kill")
                        .args(["-TERM", "--", &format!("-{pid}")])
                        .output();
                }
                let _ = child.kill();
            }
        }
    }
}
fn quiet(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
pub fn root() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("TONALIA_AI_HOME") {
        return Ok(PathBuf::from(path));
    }
    let base = std::env::var_os(if cfg!(windows) {
        "LOCALAPPDATA"
    } else {
        "HOME"
    })
    .ok_or("Cannot locate the local AI data directory.")?;
    Ok(PathBuf::from(base).join(if cfg!(windows) {
        "Tonalia/ai-v1"
    } else {
        ".local/share/tonalia/ai-v1"
    }))
}
fn runtime(root: &Path) -> PathBuf {
    root.join(if cfg!(windows) {
        "venv/Scripts/python.exe"
    } else {
        "venv/bin/python"
    })
}
fn python() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            if let Ok(entries) = fs::read_dir(PathBuf::from(local).join("Programs/Python")) {
                for entry in entries.flatten() {
                    candidates.push(entry.path().join("python.exe"));
                }
            }
        }
    }
    candidates.extend([PathBuf::from("python3"), PathBuf::from("python")]);
    candidates.into_iter().find(|path| {
        quiet(path)
            .args([
                "-c",
                "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)",
            ])
            .output()
            .is_ok_and(|r| r.status.success())
    })
}
fn pack_digest(assets: &[Value], pack: &str) -> String {
    use sha2::{Digest, Sha256};
    let lines: Vec<_> = assets
        .iter()
        .filter(|item| item["pack"] == pack)
        .map(|item| {
            format!(
                "{}:{}:{}",
                item["name"].as_str().unwrap_or(""),
                item["sha256"].as_str().unwrap_or(""),
                item["size"].as_u64().unwrap_or(0)
            )
        })
        .collect();
    format!("{:x}", Sha256::digest(lines.join("\n").as_bytes()))
}
fn write_support(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    // Preserve already verified packs when an unrelated model is upgraded.
    if let Ok(previous) = fs::read_to_string(root.join("models.json")) {
        use sha2::{Digest, Sha256};
        if let Ok(old) = serde_json::from_str::<Vec<Value>>(&previous) {
            let next: Vec<Value> =
                serde_json::from_str(include_str!("../../tools/audio-ai/models.json"))
                    .map_err(|e| e.to_string())?;
            let legacy = format!("{:x}", Sha256::digest(previous.as_bytes()));
            for pack in ["music", "sound", "identify"] {
                let stamp = root.join(format!("{pack}.ready"));
                if fs::read_to_string(&stamp).is_ok_and(|value| value == legacy)
                    && pack_digest(&old, pack) == pack_digest(&next, pack)
                {
                    fs::write(stamp, pack_digest(&next, pack)).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    for (name, contents) in [
        ("worker.py", include_str!("../../tools/audio-ai/worker.py")),
        (
            "requirements.txt",
            include_str!("../../tools/audio-ai/requirements.txt"),
        ),
        (
            "models.json",
            include_str!("../../tools/audio-ai/models.json"),
        ),
        ("README.md", include_str!("../../tools/audio-ai/README.md")),
        (
            "AUDIOSEP-LICENSE.txt",
            include_str!("../../tools/audio-ai/AUDIOSEP-LICENSE.txt"),
        ),
        (
            "MSCLAP-LICENSE.txt",
            include_str!("../../tools/audio-ai/MSCLAP-LICENSE.txt"),
        ),
        (
            "PANNS-LICENSE.txt",
            include_str!("../../tools/audio-ai/PANNS-LICENSE.txt"),
        ),
        (
            "AUDIOSET-ATTRIBUTION.txt",
            include_str!("../../tools/audio-ai/AUDIOSET-ATTRIBUTION.txt"),
        ),
        (
            "DEMUCS-LICENSE.txt",
            include_str!("../../tools/audio-ai/DEMUCS-LICENSE.txt"),
        ),
    ] {
        let path = root.join(name);
        if fs::read_to_string(&path).ok().as_deref() != Some(contents) {
            fs::write(path, contents).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    python_available: bool,
    runtime_ready: bool,
    music: bool,
    sound: bool,
    identify: bool,
    busy: bool,
}
pub fn status(jobs: &Jobs) -> Result<Status, String> {
    let root = root()?;
    write_support(&root)?;
    let assets: Vec<Value> = serde_json::from_str(include_str!("../../tools/audio-ai/models.json"))
        .map_err(|e| e.to_string())?;
    let ready = |pack: &str| {
        fs::read_to_string(root.join(format!("{pack}.ready")))
            .is_ok_and(|text| text == pack_digest(&assets, pack))
            && assets
                .iter()
                .filter(|item| item["pack"] == pack)
                .all(|item| {
                    let name = item["name"].as_str().unwrap_or("");
                    fs::metadata(root.join("models").join(name))
                        .is_ok_and(|meta| Some(meta.len()) == item["size"].as_u64())
                })
    };
    let runtime_ready = runtime(&root).exists() && root.join("runtime.ready").exists();
    Ok(Status {
        python_available: runtime_ready || python().is_some(),
        runtime_ready,
        music: ready("music"),
        sound: ready("sound"),
        identify: ready("identify"),
        busy: jobs
            .current
            .lock()
            .map_err(|_| "AI job registry unavailable")?
            .is_some(),
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub mode: String,
    pub start: u64,
    pub end: u64,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub prompts: Vec<String>,
    #[serde(default)]
    pub sensitivity: f64,
    #[serde(default = "default_cleanup")]
    pub cleanup: f64,
    #[serde(default = "default_confidence")]
    pub confidence: f64,
    pub source_hash: String,
}
fn default_cleanup() -> f64 {
    0.55
}
fn default_confidence() -> f64 {
    0.35
}
pub fn reserve(jobs: &Jobs) -> Result<Arc<Control>, String> {
    let mut current = jobs
        .current
        .lock()
        .map_err(|_| "AI job registry unavailable")?;
    if current.is_some() {
        return Err("Finish or cancel the current AI job first.".into());
    }
    let control = Arc::new(Control {
        child: Mutex::new(None),
        cancelled: AtomicBool::new(false),
    });
    *current = Some(control.clone());
    Ok(control)
}
pub fn execute(
    app: tauri::AppHandle,
    control: Arc<Control>,
    request: Value,
    job_id: &str,
    install: bool,
) -> Result<Value, String> {
    let root = root()?;
    write_support(&root)?;
    let executable = if install && !root.join("runtime.ready").exists() {
        python().ok_or("Install Python 3.11 or newer, then retry installing the local AI pack.")?
    } else {
        runtime(&root)
    };
    if !executable.exists() && executable.components().count() > 1 {
        return Err("Install a local AI pack first to prepare the inference runtime.".into());
    }
    let mut command = quiet(executable);
    command
        .env("PYTHONUTF8", "1")
        .args(["-u"])
        .arg(root.join("worker.py"))
        .arg("--root")
        .arg(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start the local AI runtime: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("AI input unavailable")?;
    let stdout = child.stdout.take().ok_or("AI output unavailable")?;
    let stderr = child.stderr.take().ok_or("AI diagnostics unavailable")?;
    // Read stderr concurrently so dependency installation cannot fill its pipe.
    let diagnostics = std::thread::spawn(move || {
        let mut stream = BufReader::new(stderr);
        let mut tail = Vec::new();
        let mut chunk = [0; 4096];
        while let Ok(n) = stream.read(&mut chunk) {
            if n == 0 {
                break;
            }
            tail.extend_from_slice(&chunk[..n]);
            if tail.len() > 8192 {
                tail.drain(..tail.len() - 8192);
            }
        }
        String::from_utf8_lossy(&tail).into_owned()
    });
    *control.child.lock().map_err(|_| "AI process unavailable")? = Some(child);
    if control.cancelled.load(Ordering::Acquire) {
        control.cancel();
    }
    stdin
        .write_all(
            serde_json::to_string(&request)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )
        .map_err(|e| e.to_string())?;
    drop(stdin);
    let mut result = None;
    let mut error = None;
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if let Ok(event) = serde_json::from_str::<Value>(&line) {
            match event["event"].as_str() {
                Some("result") => result = Some(event["result"].clone()),
                Some("error") => {
                    error = Some(
                        event["message"]
                            .as_str()
                            .unwrap_or("AI job failed")
                            .to_owned(),
                    )
                }
                Some("progress") => {
                    let _ = app.emit("separation-progress", json!({"jobId": job_id, "message": event["message"], "progress": event["progress"]}));
                }
                _ => (),
            }
        }
    }
    let status = control
        .child
        .lock()
        .map_err(|_| "AI process unavailable")?
        .as_mut()
        .ok_or("AI process unavailable")?
        .wait()
        .map_err(|e| e.to_string())?;
    let diagnostics = diagnostics.join().unwrap_or_default();
    if control.cancelled.load(Ordering::Acquire) {
        return Err("AI job cancelled.".into());
    }
    if !status.success() || error.is_some() {
        return Err(error.unwrap_or_else(|| {
            format!(
                "The local AI worker stopped. {}",
                diagnostics
                    .chars()
                    .rev()
                    .take(1200)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect::<String>()
            )
        }));
    }
    result.ok_or("The AI worker finished without a result.".into())
}
pub fn export_tracks(job_id: &str, destination: &Path) -> Result<usize, String> {
    if job_id.is_empty()
        || !job_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid separation job ID.".into());
    }
    let folder = root()?.join("jobs").join(job_id);
    let mut result: Value =
        serde_json::from_slice(&fs::read(folder.join("result.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let tracks = result["tracks"]
        .as_array()
        .ok_or("No separated tracks available.")?
        .clone();
    if tracks.is_empty() {
        return Err("No separated tracks available.".into());
    }
    // A new subfolder avoids overwriting any existing files, including a source recording.
    let output = destination.join(format!("Tonalia-{job_id}"));
    fs::create_dir(&output).map_err(|e| {
        format!("Choose another folder or remove the existing separation export: {e}")
    })?;
    let mut copy = || -> Result<(), String> {
        for (index, track) in tracks.iter().enumerate() {
            let name: String = track["name"]
                .as_str()
                .unwrap_or("Track")
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == ' ' || c == '-' {
                        c
                    } else {
                        '_'
                    }
                })
                .take(80)
                .collect();
            let filename = format!("{:02} {name}.wav", index + 1);
            fs::copy(
                folder.join(format!("track-{:02}.wav", index + 1)),
                output.join(&filename),
            )
            .map_err(|e| e.to_string())?;
            result["tracks"][index]["path"] = Value::String(filename);
        }
        fs::write(
            output.join("separation.json"),
            serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    };
    if let Err(error) = copy() {
        let _ = fs::remove_dir_all(output);
        return Err(error);
    }
    Ok(tracks.len())
}
