//! 사진 EXIF 메타데이터. JPEG·PNG·WebP·HEIF 컨테이너 공용.

use std::{fs::File, io::BufReader, path::Path};

use ::exif::{Exif, Field, In, Reader, Tag, Value};
use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, Utc};

#[derive(Debug, Clone, PartialEq)]
pub struct PhotoMeta {
    pub taken_at: Option<ExifTime>,
    /// EXIF Orientation 1~8. 없거나 범위 밖이면 1.
    pub orientation: u32,
    /// (위도, 경도). 남위·서경은 음수.
    pub gps: Option<(f64, f64)>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ExifTime {
    /// `OffsetTimeOriginal` 있음.
    Absolute(DateTime<Utc>),
    /// 오프셋 없음. 인스턴스 시간대 해석은 SQL 쪽.
    Naive(NaiveDateTime),
}

/// EXIF 없음·파싱 실패는 전부 `None`, orientation 1.
pub fn read_meta(path: &Path) -> PhotoMeta {
    let exif = File::open(path).ok().and_then(|f| {
        Reader::new()
            .read_from_container(&mut BufReader::new(f))
            .ok()
    });
    let Some(exif) = exif else {
        return PhotoMeta {
            taken_at: None,
            orientation: 1,
            gps: None,
            camera_make: None,
            camera_model: None,
        };
    };
    PhotoMeta {
        taken_at: taken_at(&exif),
        orientation: field(&exif, Tag::Orientation)
            .and_then(|f| f.value.get_uint(0))
            .filter(|o| (1..=8).contains(o))
            .unwrap_or(1),
        gps: gps(&exif),
        camera_make: text(&exif, Tag::Make),
        camera_model: text(&exif, Tag::Model),
    }
}

fn field(exif: &Exif, tag: Tag) -> Option<&Field> {
    exif.get_field(tag, In::PRIMARY)
}

fn ascii(exif: &Exif, tag: Tag) -> Option<&[u8]> {
    match &field(exif, tag)?.value {
        Value::Ascii(v) => v.first().map(Vec::as_slice),
        _ => None,
    }
}

fn text(exif: &Exif, tag: Tag) -> Option<String> {
    let s = String::from_utf8_lossy(ascii(exif, tag)?);
    let s = s.trim_matches(|c: char| c == '\0' || c.is_whitespace());
    (!s.is_empty()).then(|| s.to_string())
}

fn taken_at(exif: &Exif) -> Option<ExifTime> {
    let mut dt = ::exif::DateTime::from_ascii(ascii(exif, Tag::DateTimeOriginal)?).ok()?;
    let naive = NaiveDate::from_ymd_opt(dt.year.into(), dt.month.into(), dt.day.into())?
        .and_hms_nano_opt(
            dt.hour.into(),
            dt.minute.into(),
            dt.second.into(),
            dt.nanosecond.unwrap_or(0),
        )?;
    // 오프셋 형식 오류는 오프셋 없음으로 취급.
    if let Some(raw) = ascii(exif, Tag::OffsetTimeOriginal)
        && dt.parse_offset(raw).is_ok()
        && let Some(minutes) = dt.offset
    {
        return Some(with_offset(naive, minutes));
    }
    Some(ExifTime::Naive(naive))
}

/// 범위 밖 오프셋은 오프셋 없음으로 취급.
fn with_offset(naive: NaiveDateTime, minutes: i16) -> ExifTime {
    FixedOffset::east_opt(i32::from(minutes) * 60)
        .and_then(|offset| naive.and_local_timezone(offset).single())
        .map_or(ExifTime::Naive(naive), |local| {
            ExifTime::Absolute(local.with_timezone(&Utc))
        })
}

fn gps(exif: &Exif) -> Option<(f64, f64)> {
    let lat = coord(exif, Tag::GPSLatitude, Tag::GPSLatitudeRef, b'S')?;
    let lon = coord(exif, Tag::GPSLongitude, Tag::GPSLongitudeRef, b'W')?;
    ((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)).then_some((lat, lon))
}

/// 도·분·초 유리수 3개 → 십진 도. 참조 태그가 `negative` 면 부호 반전.
fn coord(exif: &Exif, tag: Tag, ref_tag: Tag, negative: u8) -> Option<f64> {
    let Value::Rational(dms) = &field(exif, tag)?.value else {
        return None;
    };
    let [d, m, s] = dms.as_slice() else {
        return None;
    };
    let v = d.to_f64() + m.to_f64() / 60.0 + s.to_f64() / 3600.0;
    if !v.is_finite() {
        return None;
    }
    let sign = match ascii(exif, ref_tag)?.first() {
        Some(c) if c.eq_ignore_ascii_case(&negative) => -1.0,
        _ => 1.0,
    };
    Some(sign * v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn out_of_range_offset_falls_back_to_naive() {
        let naive = NaiveDate::from_ymd_opt(2024, 5, 1)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        assert_eq!(with_offset(naive, 25 * 60), ExifTime::Naive(naive));
        let ExifTime::Absolute(utc) = with_offset(naive, 9 * 60) else {
            panic!("absolute 기대");
        };
        assert_eq!(utc.naive_utc(), naive - chrono::Duration::hours(9));
    }
}
