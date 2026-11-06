//! 목록 커서. `"<RFC3339 마이크로초>|<uuid>"` 의 base64url(패딩 없음).

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, SecondsFormat, Utc};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub fn encode(ts: DateTime<Utc>, id: Uuid) -> String {
    let raw = format!("{}|{id}", ts.to_rfc3339_opts(SecondsFormat::Micros, true));
    URL_SAFE_NO_PAD.encode(raw)
}

pub fn decode(s: &str) -> AppResult<(DateTime<Utc>, Uuid)> {
    parse(s).ok_or_else(|| AppError::bad_request("asset.invalidCursor"))
}

fn parse(s: &str) -> Option<(DateTime<Utc>, Uuid)> {
    let raw = String::from_utf8(URL_SAFE_NO_PAD.decode(s).ok()?).ok()?;
    let (ts, id) = raw.split_once('|')?;
    Some((
        DateTime::parse_from_rfc3339(ts).ok()?.with_timezone(&Utc),
        id.parse().ok()?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_microseconds() {
        let ts = DateTime::parse_from_rfc3339("2024-05-01T16:00:00.123456Z")
            .unwrap()
            .with_timezone(&Utc);
        let id = Uuid::now_v7();
        assert_eq!(decode(&encode(ts, id)).unwrap(), (ts, id));
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode("zzz").is_err());
        assert!(decode(&URL_SAFE_NO_PAD.encode("no-separator")).is_err());
    }
}
