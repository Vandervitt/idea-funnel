-- Idea Funnel initial schema. Idempotent: safe to run more than once.
-- Apply manually: psql "$DATABASE_URL" -f migrations/20261029_init.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS ideas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         text        NOT NULL,
  title            text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description      text        NOT NULL DEFAULT '',
  stage            text        NOT NULL DEFAULT 'inbox'
                   CHECK (stage IN ('inbox', 'evaluating', 'validating', 'building', 'shipped', 'dropped')),
  impact           smallint    CHECK (impact BETWEEN 1 AND 10),
  confidence       smallint    CHECK (confidence BETWEEN 1 AND 10),
  ease             smallint    CHECK (ease BETWEEN 1 AND 10),
  -- Integer division truncates: (7+8+8)*10/3 = 76 → "7.6".
  ice_x10          smallint    GENERATED ALWAYS AS ((impact + confidence + ease) * 10 / 3) STORED,
  source           text        NOT NULL DEFAULT '',
  links            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  conclusion       text        NOT NULL DEFAULT '',
  stage_changed_at timestamptz(3) NOT NULL DEFAULT now(),
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT ideas_ice_all_or_none CHECK (
    (impact IS NULL AND confidence IS NULL AND ease IS NULL)
    OR (impact IS NOT NULL AND confidence IS NOT NULL AND ease IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ideas_owner_stage_updated_idx ON ideas (owner_id, stage, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ideas_owner_updated_idx       ON ideas (owner_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ideas_owner_created_idx       ON ideas (owner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ideas_owner_ice_idx           ON ideas (owner_id, ice_x10 DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS ideas_search_trgm_idx         ON ideas USING gin ((title || ' ' || description) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS tags (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  name     text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
  CONSTRAINT tags_owner_name_key UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS idea_tags (
  idea_id uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (idea_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idea_tags_tag_idx ON idea_tags (tag_id, idea_id);

CREATE TABLE IF NOT EXISTS idea_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id    uuid        NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  type       text        NOT NULL CHECK (type IN ('created', 'stage', 'note')),
  from_stage text,
  to_stage   text,
  note       text        NOT NULL DEFAULT '',
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idea_events_idea_idx ON idea_events (idea_id, created_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip           text PRIMARY KEY,
  failures     integer     NOT NULL DEFAULT 0,
  locked_until timestamptz(3),
  updated_at   timestamptz(3) NOT NULL DEFAULT now()
);
