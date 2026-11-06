CREATE TYPE asset_kind AS ENUM ('photo', 'video');
CREATE TYPE asset_status AS ENUM ('processing', 'ready', 'failed');
CREATE TYPE taken_at_source AS ENUM ('exif', 'video_meta', 'file_mtime', 'upload_time', 'import', 'manual');
CREATE TYPE job_status AS ENUM ('queued', 'running', 'failed');
CREATE TYPE baby_sex AS ENUM ('female', 'male');

CREATE TABLE assets (
  id                uuid PRIMARY KEY,
  kind              asset_kind NOT NULL,
  uploaded_by       uuid NOT NULL REFERENCES users(id),
  original_path     text NOT NULL,
  original_filename text NOT NULL,
  mime              text NOT NULL,
  size_bytes        bigint NOT NULL,
  sha256            bytea NOT NULL UNIQUE,
  width             integer,
  height            integer,
  duration_ms       integer,
  taken_at          timestamptz NOT NULL,
  taken_at_source   taken_at_source NOT NULL,
  file_modified_at  timestamptz,
  gps_lat           double precision,
  gps_lon           double precision,
  camera_make       text,
  camera_model      text,
  blurhash          text,
  dominant_color    text,
  caption           text,
  status            asset_status NOT NULL DEFAULT 'processing',
  processing_error  text,
  derivatives       jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX assets_timeline_idx ON assets (taken_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX assets_trash_idx ON assets (deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL;

CREATE TABLE babies (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  birth_date      date NOT NULL,
  sex             baby_sex,
  avatar_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_babies (
  asset_id  uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  baby_id   uuid NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  tagged_by uuid NOT NULL REFERENCES users(id),
  tagged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, baby_id)
);
CREATE INDEX asset_babies_baby_idx ON asset_babies (baby_id);

CREATE TABLE uploads (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  length     bigint NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE jobs (
  id         uuid PRIMARY KEY,
  kind       text NOT NULL,
  payload    jsonb NOT NULL,
  status     job_status NOT NULL DEFAULT 'queued',
  attempts   integer NOT NULL DEFAULT 0,
  run_after  timestamptz NOT NULL DEFAULT now(),
  locked_at  timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queue_idx ON jobs (run_after) WHERE status = 'queued';
