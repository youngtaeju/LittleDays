-- 기록: 이야기, 성장 기록, 마일스톤.
-- 사진 연결은 사진 휴지통 이동 시 보존, 완전 삭제 시 함께 삭제. 이야기 삭제 시 연결과 반응 삭제.
-- 아기 삭제 시 그 아기의 성장 기록, 마일스톤, 이야기 태그 삭제.

CREATE TABLE stories (
  id         uuid PRIMARY KEY,
  author_id  uuid NOT NULL REFERENCES users(id),
  entry_date date NOT NULL,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz
);
CREATE INDEX stories_entry_date_idx ON stories (entry_date, id);

CREATE TABLE story_babies (
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  baby_id  uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, baby_id)
);
-- 아기 필터, 아기 삭제 cascade.
CREATE INDEX story_babies_baby_idx ON story_babies (baby_id);

CREATE TABLE story_assets (
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  position int NOT NULL,
  PRIMARY KEY (story_id, asset_id)
);
CREATE INDEX story_assets_asset_idx ON story_assets (asset_id);

CREATE TABLE story_likes (
  story_id   uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);

CREATE TABLE story_comments (
  id         uuid PRIMARY KEY,
  story_id   uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz
);
CREATE INDEX story_comments_story_idx ON story_comments (story_id, created_at, id);

CREATE TABLE growth_records (
  id          uuid PRIMARY KEY,
  baby_id     uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  measured_on date NOT NULL,
  height_cm   numeric(4,1),
  weight_kg   numeric(5,2),
  note        text,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (height_cm IS NOT NULL OR weight_kg IS NOT NULL)
);
CREATE INDEX growth_records_baby_idx ON growth_records (baby_id, measured_on);

CREATE TABLE milestones (
  id           uuid PRIMARY KEY,
  baby_id      uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  preset_key   text,
  custom_label text,
  achieved_on  date NOT NULL,
  note         text,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((preset_key IS NULL) <> (custom_label IS NULL))
);
-- 미리 정한 항목은 아기당 한 번.
CREATE UNIQUE INDEX milestones_preset_idx ON milestones (baby_id, preset_key)
  WHERE preset_key IS NOT NULL;
-- 아기별 달성일 순 목록.
CREATE INDEX milestones_baby_idx ON milestones (baby_id, achieved_on);

CREATE TABLE milestone_assets (
  milestone_id uuid NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  asset_id     uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  position     int NOT NULL,
  PRIMARY KEY (milestone_id, asset_id)
);
CREATE INDEX milestone_assets_asset_idx ON milestone_assets (asset_id);
