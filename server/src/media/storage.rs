use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use uuid::Uuid;

/// `DATA_DIR` 기준 상대 경로. 연/월은 asset `created_at` UTC.
pub fn original_rel_path(created_at: DateTime<Utc>, id: Uuid, ext: &str) -> PathBuf {
    PathBuf::from(created_at.format("originals/%Y/%m").to_string()).join(format!("{id}.{ext}"))
}

pub fn derivative_dir(data_dir: &Path, id: Uuid) -> PathBuf {
    data_dir.join("derivatives").join(id.to_string())
}

pub fn upload_temp_path(data_dir: &Path, upload_id: Uuid) -> PathBuf {
    data_dir
        .join("tmp/uploads")
        .join(format!("{upload_id}.part"))
}

pub fn ensure_dirs(data_dir: &Path) -> std::io::Result<()> {
    for sub in ["originals", "derivatives", "tmp/uploads"] {
        std::fs::create_dir_all(data_dir.join(sub))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use chrono::{TimeZone, Utc};
    use uuid::Uuid;

    use super::*;

    #[test]
    fn paths_follow_layout() {
        let id = Uuid::now_v7();
        let at = Utc.with_ymd_and_hms(2026, 11, 6, 0, 0, 0).unwrap();
        assert_eq!(
            original_rel_path(at, id, "heic"),
            PathBuf::from(format!("originals/2026/11/{id}.heic"))
        );
        assert_eq!(
            derivative_dir(Path::new("/d"), id),
            PathBuf::from(format!("/d/derivatives/{id}"))
        );
        assert_eq!(
            upload_temp_path(Path::new("/d"), id),
            PathBuf::from(format!("/d/tmp/uploads/{id}.part"))
        );

        let dir = tempfile::tempdir().unwrap();
        ensure_dirs(dir.path()).unwrap();
        for sub in ["originals", "derivatives", "tmp/uploads"] {
            assert!(dir.path().join(sub).is_dir(), "{sub}");
        }
    }
}
