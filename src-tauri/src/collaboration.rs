//! Opt-in LAN session. Serialized revisions prevent silent lost updates; audio never traverses this service.
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    net::{IpAddr, Ipv4Addr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tonalia_core::{validate_layers, Layer};
const LIMIT: u64 = 4 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub sha256: String,
    pub frames: u64,
    pub sample_rate: u32,
    pub channels: u16,
}
impl Identity {
    fn validate(&self) -> Result<(), String> {
        if self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || self.frames == 0
            || !(8000..=192000).contains(&self.sample_rate)
            || !(1..=2).contains(&self.channels)
        {
            return Err("Invalid source identity.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub revision: u64,
    pub identity: Identity,
    pub layers: Vec<Layer>,
    pub conflict: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub token: String,
    pub identity: Identity,
    pub base_revision: Option<u64>,
    pub layers: Option<Vec<Layer>>,
}
pub struct Host {
    stop: Arc<AtomicBool>,
}
impl Drop for Host {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub endpoint: String,
    pub token: String,
    pub snapshot: Snapshot,
}
fn authorized(a: &str, b: &str) -> bool {
    a.len() == 64
        && b.len() == 64
        && a.bytes().zip(b.bytes()).fold(0u8, |n, (x, y)| n | (x ^ y)) == 0
}
fn transact(snapshot: &mut Snapshot, token: &str, request: Request) -> Result<Snapshot, String> {
    if !authorized(token, &request.token) {
        return Err("Invalid session token.".into());
    }
    if request.identity != snapshot.identity {
        return Err("Source SHA-256 or audio format does not match the host. Open the identical WAV locally.".into());
    }
    if let Some(layers) = request.layers {
        let id = &snapshot.identity;
        validate_layers(&layers, id.frames, id.sample_rate, id.channels)?;
        if request.base_revision != Some(snapshot.revision) {
            let mut response = snapshot.clone();
            response.conflict = true;
            return Ok(response);
        }
        snapshot.layers = layers;
        snapshot.revision += 1;
    }
    Ok(snapshot.clone())
}
pub fn start(identity: Identity, layers: Vec<Layer>, lan: bool) -> Result<(Host, Started), String> {
    identity.validate()?;
    validate_layers(
        &layers,
        identity.frames,
        identity.sample_rate,
        identity.channels,
    )?;
    let server = tiny_http::Server::http((
        if lan {
            Ipv4Addr::UNSPECIFIED
        } else {
            Ipv4Addr::LOCALHOST
        },
        0,
    ))
    .map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("No listener address")?
        .port();
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    let token = bytes.iter().map(|v| format!("{v:02x}")).collect::<String>();
    let snapshot = Snapshot {
        revision: 0,
        identity,
        layers,
        conflict: false,
    };
    let started = Started {
        endpoint: format!("http://127.0.0.1:{port}/session"),
        token: token.clone(),
        snapshot: snapshot.clone(),
    };
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    std::thread::Builder::new()
        .name("tonalia-lan-session".into())
        .spawn(move || {
            let mut snapshot = snapshot;
            while !stopped.load(Ordering::Acquire) {
                let Ok(Some(mut incoming)) = server.recv_timeout(Duration::from_millis(200)) else {
                    continue;
                };
                let result = (|| -> Result<Snapshot, String> {
                    if incoming.method() != &tiny_http::Method::Post
                        || incoming.url() != "/session"
                        || incoming.headers().iter().any(|h| h.field.equiv("Origin"))
                    {
                        return Err("Only native session requests are accepted.".into());
                    }
                    if incoming.body_length().is_none_or(|n| n as u64 > LIMIT) {
                        return Err("Session request is too large or lacks Content-Length.".into());
                    }
                    let mut body = Vec::new();
                    incoming
                        .as_reader()
                        .take(LIMIT + 1)
                        .read_to_end(&mut body)
                        .map_err(|e| e.to_string())?;
                    if body.len() as u64 > LIMIT {
                        return Err("Session request exceeds the manifest limit.".into());
                    }
                    let request =
                        serde_json::from_slice(&body).map_err(|_| "Invalid session request.")?;
                    transact(&mut snapshot, &token, request)
                })();
                let (status, body) = match result {
                    Ok(value) => (200, serde_json::to_string(&value).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({"error":e}).to_string()),
                };
                let response = tiny_http::Response::from_string(body)
                    .with_status_code(status)
                    .with_header(
                        tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap(),
                    );
                let _ = incoming.respond(response);
            }
        })
        .map_err(|e| e.to_string())?;
    Ok((Host { stop }, started))
}
pub fn exchange(endpoint: String, request: Request) -> Result<Snapshot, String> {
    // Numeric private or loopback addresses only: no DNS, proxy, redirects or public internet destinations.
    let rest = endpoint
        .strip_prefix("http://")
        .ok_or("Use an http:// LAN address.")?;
    let authority = rest
        .strip_suffix("/session")
        .ok_or("Invalid session path.")?;
    let socket = authority
        .parse::<std::net::SocketAddr>()
        .map_err(|_| "Use a numeric LAN IP and port (for example 192.168.1.4:5000).")?;
    let private = match socket.ip() {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local(),
    };
    if !private || socket.port() == 0 {
        return Err("Session endpoints must use a private or loopback IP.".into());
    }
    request.identity.validate()?;
    let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    if body.len() as u64 > LIMIT {
        return Err("Session manifest exceeds 4 MiB.".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(5))
        .redirects(0)
        .build();
    let result = agent
        .post(&endpoint)
        .set("Content-Type", "application/json")
        .send_string(&body);
    let response =
        match result {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(_) => return Err(
                "Cannot reach the session host. Check its address, firewall and session status."
                    .into(),
            ),
        };
    let success = response.status() == 200;
    let mut body = String::new();
    response
        .into_reader()
        .take(LIMIT + 1)
        .read_to_string(&mut body)
        .map_err(|e| e.to_string())?;
    if body.len() as u64 > LIMIT {
        return Err("Host response exceeds 4 MiB.".into());
    }
    if !success {
        return Err(serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v["error"].as_str().map(String::from))
            .unwrap_or("Session rejected the request.".into()));
    }
    let snapshot: Snapshot = serde_json::from_str(&body).map_err(|_| "Invalid host response.")?;
    if snapshot.identity != request.identity {
        return Err("Host source changed.".into());
    }
    validate_layers(
        &snapshot.layers,
        snapshot.identity.frames,
        snapshot.identity.sample_rate,
        snapshot.identity.channels,
    )?;
    Ok(snapshot)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn identity() -> Identity {
        Identity {
            sha256: "a".repeat(64),
            frames: 48000,
            sample_rate: 48000,
            channels: 2,
        }
    }
    fn request(token: &str, revision: Option<u64>, layers: Option<Vec<Layer>>) -> Request {
        Request {
            token: token.into(),
            identity: identity(),
            base_revision: revision,
            layers,
        }
    }
    #[test]
    fn loopback_sessions_reject_wrong_source_tokens_and_stale_writes() {
        let (host, started) = start(identity(), vec![], false).unwrap();
        let endpoint = started.endpoint.clone();
        let token = started.token;
        assert!(exchange(endpoint.clone(), request(&"0".repeat(64), None, None)).is_err());
        let mut wrong = request(&token, None, None);
        wrong.identity.sha256 = "b".repeat(64);
        assert!(exchange(endpoint.clone(), wrong).is_err());
        assert_eq!(
            exchange(endpoint.clone(), request(&token, Some(0), Some(vec![])))
                .unwrap()
                .revision,
            1
        );
        let conflict = exchange(endpoint.clone(), request(&token, Some(0), Some(vec![]))).unwrap();
        assert!(conflict.conflict);
        assert_eq!(conflict.revision, 1);
        assert_eq!(
            exchange(endpoint.clone(), request(&token, None, None))
                .unwrap()
                .revision,
            1
        );
        drop(host);
        std::thread::sleep(Duration::from_millis(400));
        assert!(exchange(endpoint, request(&token, None, None)).is_err());
    }
    #[test]
    fn external_endpoints_are_rejected() {
        for endpoint in [
            "http://8.8.8.8:80/session",
            "https://127.0.0.1:80/session",
            "http://example.com:80/session",
            "http://127.0.0.1:80/session?foo",
        ] {
            assert!(exchange(endpoint.into(), request(&"a".repeat(64), None, None)).is_err());
        }
    }
}
