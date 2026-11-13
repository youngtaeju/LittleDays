-- 앨범: 사진/영상 묶음. 중첩 없음.
-- 사진 연결은 사진 휴지통 이동 시 보존(응답에서 제외), 완전 삭제 시 함께 삭제. 표지는 완전 삭제 시 비움.
-- 앨범 삭제 시 연결만 삭제, 사진은 남음.

CREATE TABLE albums (
  id             uuid PRIMARY KEY,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  cover_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE album_assets (
  album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (album_id, asset_id)
);
CREATE INDEX album_assets_asset_idx ON album_assets (asset_id);
