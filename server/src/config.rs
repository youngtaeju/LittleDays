use std::path::PathBuf;

use anyhow::{Context, bail};

pub struct Config {
    pub database_url: String,
    pub public_url: String,
    pub secret_key: Vec<u8>,
    pub data_dir: PathBuf,
    pub port: u16,
    pub auto_migrate: bool,
    pub worker_concurrency: usize,
    /// 빌드된 SPA 디렉터리. 없으면 API 만 서빙.
    pub web_dir: Option<PathBuf>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Config> {
        let database_url = database_url()?;

        let public_url = parse_public_url(required("PUBLIC_URL")?)?;
        let secret_key = parse_secret_key(&required("SECRET_KEY")?)?;

        let data_dir = data_dir();

        let port = match std::env::var("PORT") {
            Ok(v) => v.parse().context("PORT must be a valid port number")?,
            Err(_) => 8080,
        };

        let auto_migrate = match std::env::var("AUTO_MIGRATE") {
            Ok(v) => v.parse().context("AUTO_MIGRATE must be true or false")?,
            Err(_) => true,
        };

        let worker_concurrency =
            parse_worker_concurrency(std::env::var("WORKER_CONCURRENCY").ok().as_deref())?;

        let web_dir = parse_web_dir(std::env::var("WEB_DIR").ok().as_deref())?;

        Ok(Config {
            database_url,
            public_url,
            secret_key,
            data_dir,
            port,
            auto_migrate,
            worker_concurrency,
            web_dir,
        })
    }
}

/// DB 만 쓰는 서브커맨드(migrate, reset-password)용. 다른 설정 불필요.
pub fn database_url() -> anyhow::Result<String> {
    required("DATABASE_URL")
}

pub fn data_dir() -> PathBuf {
    std::env::var("DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./data"))
}

fn required(key: &str) -> anyhow::Result<String> {
    std::env::var(key).with_context(|| format!("{key} is required"))
}

fn parse_worker_concurrency(v: Option<&str>) -> anyhow::Result<usize> {
    let Some(v) = v else { return Ok(2) };
    match v.parse::<usize>() {
        Ok(n) if (1..=16).contains(&n) => Ok(n),
        _ => bail!("WORKER_CONCURRENCY must be 1-16"),
    }
}

fn parse_web_dir(v: Option<&str>) -> anyhow::Result<Option<PathBuf>> {
    let Some(v) = v.filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let dir = PathBuf::from(v);
    if !dir.join("index.html").is_file() {
        bail!("WEB_DIR must contain index.html");
    }
    Ok(Some(dir))
}

fn parse_public_url(url: String) -> anyhow::Result<String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        bail!("PUBLIC_URL must start with http:// or https://");
    }
    // `{PUBLIC_URL}/path` 조합 시 이중 슬래시 방지.
    Ok(url.trim_end_matches('/').to_string())
}

fn parse_secret_key(s: &str) -> anyhow::Result<Vec<u8>> {
    let key = decode_hex(s).context("SECRET_KEY must be 64 hex characters")?;
    if key.len() != 32 {
        bail!("SECRET_KEY must be 64 hex characters");
    }
    Ok(key)
}

fn decode_hex(s: &str) -> anyhow::Result<Vec<u8>> {
    // from_str_radix 는 선행 `+` 허용. 16진 문자만 통과.
    if !s.bytes().all(|b| b.is_ascii_hexdigit()) || !s.len().is_multiple_of(2) {
        bail!("invalid hex string");
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).context("invalid hex string"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_key_accepts_lower_and_upper_hex() {
        assert_eq!(parse_secret_key(&"ab".repeat(32)).unwrap().len(), 32);
        assert_eq!(parse_secret_key(&"AB".repeat(32)).unwrap().len(), 32);
    }

    #[test]
    fn secret_key_rejects_invalid_input() {
        let valid = "ab".repeat(32);
        let mut non_hex = valid.clone();
        non_hex.replace_range(0..2, "zz");
        let mut plus = valid.clone();
        plus.replace_range(0..2, "+f");
        let mut multibyte = valid.clone();
        multibyte.replace_range(0..2, "é");
        for bad in [
            valid[..63].to_string(),
            non_hex,
            plus,
            multibyte,
            "ab".repeat(31),
            "ab".repeat(33),
        ] {
            assert!(parse_secret_key(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn decode_hex_rejects_plus_and_odd_length() {
        assert!(decode_hex("+f").is_err());
        assert!(decode_hex("abc").is_err());
        assert_eq!(decode_hex("0aFf").unwrap(), vec![0x0a, 0xff]);
    }

    #[test]
    fn public_url_trims_trailing_slash() {
        assert_eq!(
            parse_public_url("https://x.example/".into()).unwrap(),
            "https://x.example"
        );
        assert_eq!(
            parse_public_url("http://x.example".into()).unwrap(),
            "http://x.example"
        );
    }

    #[test]
    fn public_url_rejects_other_schemes() {
        assert!(parse_public_url("ftp://x".into()).is_err());
    }

    #[test]
    fn worker_concurrency_parsing() {
        assert_eq!(parse_worker_concurrency(None).unwrap(), 2);
        assert_eq!(parse_worker_concurrency(Some("1")).unwrap(), 1);
        assert_eq!(parse_worker_concurrency(Some("16")).unwrap(), 16);
        for bad in ["0", "17", "x"] {
            let err = parse_worker_concurrency(Some(bad)).unwrap_err();
            assert_eq!(err.to_string(), "WORKER_CONCURRENCY must be 1-16", "{bad}");
        }
    }

    #[test]
    fn web_dir_requires_index() {
        assert_eq!(parse_web_dir(None).unwrap(), None);
        assert_eq!(parse_web_dir(Some("")).unwrap(), None);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        let err = parse_web_dir(Some(path)).unwrap_err();
        assert_eq!(err.to_string(), "WEB_DIR must contain index.html");

        std::fs::write(dir.path().join("index.html"), "x").unwrap();
        assert_eq!(parse_web_dir(Some(path)).unwrap(), Some(dir.path().into()));
    }
}
