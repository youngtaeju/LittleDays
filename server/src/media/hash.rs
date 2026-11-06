use std::{
    fs::File,
    io::{self, BufReader},
    path::Path,
};

use sha2::{Digest, Sha256};

/// 파일 전체 sha256. blocking. 호출 측이 `spawn_blocking`.
pub fn sha256_file(path: &Path) -> io::Result<[u8; 32]> {
    let mut reader = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut hasher = Sha256::new();
    io::copy(&mut reader, &mut hasher)?;
    Ok(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_file_contents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abc");
        std::fs::write(&path, b"abc").unwrap();
        let hex: String = sha256_file(&path)
            .unwrap()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(
            hex,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
