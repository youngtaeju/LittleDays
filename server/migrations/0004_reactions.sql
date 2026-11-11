-- 사진 반응. 휴지통 이동 시 보존, 완전 삭제 시 함께 삭제.

CREATE TABLE asset_likes (
  asset_id   uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, user_id)
);

CREATE TABLE asset_favorites (
  asset_id   uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, user_id)
);
-- 내 즐겨찾기 목록 커서 순서.
CREATE INDEX asset_favorites_user_idx ON asset_favorites (user_id, created_at DESC, asset_id DESC);

CREATE TABLE asset_comments (
  id         uuid PRIMARY KEY,
  asset_id   uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz
);
CREATE INDEX asset_comments_asset_idx ON asset_comments (asset_id, created_at, id);
