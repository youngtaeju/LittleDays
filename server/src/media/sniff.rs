//! 앞부분 바이트로 형식 판별. 확장자·클라이언트 MIME 은 신뢰하지 않음.

use crate::assets::AssetKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaType {
    Jpeg,
    Png,
    Webp,
    Heic,
    Heif,
    Avif,
    Mp4,
    Mov,
    Webm,
}

impl MediaType {
    pub fn kind(self) -> AssetKind {
        match self {
            MediaType::Mp4 | MediaType::Mov | MediaType::Webm => AssetKind::Video,
            _ => AssetKind::Photo,
        }
    }

    /// 원본 파일 확장자.
    pub fn ext(self) -> &'static str {
        match self {
            MediaType::Jpeg => "jpg",
            MediaType::Png => "png",
            MediaType::Webp => "webp",
            MediaType::Heic => "heic",
            MediaType::Heif => "heif",
            MediaType::Avif => "avif",
            MediaType::Mp4 => "mp4",
            MediaType::Mov => "mov",
            MediaType::Webm => "webm",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            MediaType::Jpeg => "image/jpeg",
            MediaType::Png => "image/png",
            MediaType::Webp => "image/webp",
            MediaType::Heic => "image/heic",
            MediaType::Heif => "image/heif",
            MediaType::Avif => "image/avif",
            MediaType::Mp4 => "video/mp4",
            MediaType::Mov => "video/quicktime",
            MediaType::Webm => "video/webm",
        }
    }

    /// `ext()` 의 역. 원본 경로에서 형식 복원용.
    pub fn from_ext(ext: &str) -> Option<MediaType> {
        Some(match ext {
            "jpg" => MediaType::Jpeg,
            "png" => MediaType::Png,
            "webp" => MediaType::Webp,
            "heic" => MediaType::Heic,
            "heif" => MediaType::Heif,
            "avif" => MediaType::Avif,
            "mp4" => MediaType::Mp4,
            "mov" => MediaType::Mov,
            "webm" => MediaType::Webm,
            _ => return None,
        })
    }
}

/// 앞 64바이트면 충분. ISO BMFF 는 `ftyp` 의 major brand 우선, 다음 compatible brands 순.
/// `mif1`/`msf1` 은 범용 HEIF 표시라 더 구체적인 brand 가 없을 때만 Heif.
pub fn sniff(head: &[u8]) -> Option<MediaType> {
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(MediaType::Jpeg);
    }
    if head.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(MediaType::Png);
    }
    if head.starts_with(b"RIFF") && head.get(8..12) == Some(b"WEBP") {
        return Some(MediaType::Webp);
    }
    if head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(MediaType::Webm);
    }
    if head.len() < 12 || &head[4..8] != b"ftyp" {
        return None;
    }
    let size = u32::from_be_bytes([head[0], head[1], head[2], head[3]]) as usize;
    let (compatible, _) = head
        .get(16..size.min(head.len()))
        .unwrap_or_default()
        .as_chunks::<4>();
    let major = [head[8], head[9], head[10], head[11]];
    let mut generic_heif = false;
    for brand in std::iter::once(&major).chain(compatible) {
        match brand_type(brand) {
            Some(MediaType::Heif) => generic_heif = true,
            Some(found) => return Some(found),
            None => {}
        }
    }
    generic_heif.then_some(MediaType::Heif)
}

fn brand_type(brand: &[u8; 4]) -> Option<MediaType> {
    Some(match brand {
        b"heic" | b"heix" | b"hevc" | b"hevx" | b"heim" | b"heis" => MediaType::Heic,
        b"avif" | b"avis" => MediaType::Avif,
        b"mif1" | b"msf1" => MediaType::Heif,
        b"qt  " => MediaType::Mov,
        b"isom" | b"iso2" | b"iso4" | b"iso5" | b"iso6" | b"mp41" | b"mp42" | b"avc1" | b"M4V "
        | b"dash" | b"3gp4" | b"3gp5" | b"3gp6" | b"3g2a" => MediaType::Mp4,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `ftyp` 박스. 크기 필드는 실제 길이.
    fn ftyp(major: &[u8; 4], compatible: &[&[u8; 4]]) -> Vec<u8> {
        let size = 16 + 4 * compatible.len();
        let mut bytes = (size as u32).to_be_bytes().to_vec();
        bytes.extend(b"ftyp");
        bytes.extend(major);
        bytes.extend([0, 0, 0, 0]);
        for brand in compatible {
            bytes.extend(*brand);
        }
        bytes
    }

    #[test]
    fn sniff_magic_bytes() {
        let cases: Vec<(Vec<u8>, MediaType)> = vec![
            (vec![0xFF, 0xD8, 0xFF, 0xE1, 0, 0], MediaType::Jpeg),
            (b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec(), MediaType::Png),
            (b"RIFF\x24\0\0\0WEBPVP8 ".to_vec(), MediaType::Webp),
            (vec![0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42], MediaType::Webm),
            (ftyp(b"heic", &[b"mif1", b"heic"]), MediaType::Heic),
            (ftyp(b"heix", &[]), MediaType::Heic),
            (ftyp(b"hevc", &[]), MediaType::Heic),
            (ftyp(b"mif1", &[b"heic"]), MediaType::Heic),
            (ftyp(b"mif1", &[b"miaf"]), MediaType::Heif),
            (ftyp(b"msf1", &[]), MediaType::Heif),
            (ftyp(b"avif", &[b"mif1", b"miaf"]), MediaType::Avif),
            (ftyp(b"mif1", &[b"miaf", b"avif"]), MediaType::Avif),
            (ftyp(b"avis", &[]), MediaType::Avif),
            (ftyp(b"qt  ", &[b"qt  "]), MediaType::Mov),
            (
                ftyp(b"isom", &[b"isom", b"iso2", b"avc1", b"mp41"]),
                MediaType::Mp4,
            ),
            (ftyp(b"mp42", &[]), MediaType::Mp4),
            (ftyp(b"M4V ", &[]), MediaType::Mp4),
            (ftyp(b"3gp4", &[]), MediaType::Mp4),
            (ftyp(b"xxxx", &[b"yyyy", b"mp42"]), MediaType::Mp4),
        ];
        for (bytes, want) in cases {
            assert_eq!(sniff(&bytes), Some(want), "{bytes:02x?}");
        }

        // compatible brands 는 박스 크기 안에서만.
        let mut outside = ftyp(b"xxxx", &[]);
        outside.extend(b"mp42");
        assert_eq!(sniff(&outside), None);

        for bytes in [
            &b""[..],
            b"hello, world",
            b"<!DOCTYPE html>",
            b"RIFF\x24\0\0\0WAVEfmt ",
            &[0xFF, 0xD8],
            b"\0\0\0\x10ftyp",
        ] {
            assert_eq!(sniff(bytes), None, "{bytes:02x?}");
        }
    }

    #[test]
    fn ext_round_trip() {
        for t in [
            MediaType::Jpeg,
            MediaType::Png,
            MediaType::Webp,
            MediaType::Heic,
            MediaType::Heif,
            MediaType::Avif,
            MediaType::Mp4,
            MediaType::Mov,
            MediaType::Webm,
        ] {
            assert_eq!(MediaType::from_ext(t.ext()), Some(t));
        }
        assert_eq!(MediaType::from_ext("txt"), None);
        assert_eq!(MediaType::Mov.mime(), "video/quicktime");
        assert_eq!(MediaType::Heic.kind(), AssetKind::Photo);
        assert_eq!(MediaType::Webm.kind(), AssetKind::Video);
    }
}
