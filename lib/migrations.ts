import type { DatabaseSync } from "node:sqlite";

const migrations = [
  `
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      lease_token TEXT,
      lease_expires_at INTEGER,
      CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
    ) STRICT;

    CREATE TABLE run_steps (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL CHECK (step_number > 0),
      type TEXT NOT NULL,
      input_json TEXT NOT NULL CHECK (json_valid(input_json)),
      output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      error TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      UNIQUE (run_id, step_number)
    ) STRICT;

    CREATE INDEX runs_user_created ON runs(user_id, created_at DESC);
    CREATE INDEX runs_queue ON runs(status, lease_expires_at, created_at);
  `,
  `
    UPDATE run_steps SET type = CASE type
      WHEN 'understand_request' THEN 'UnderstandRequestProcessor'
      WHEN 'search_information' THEN 'SearchInformationProcessor'
      WHEN 'prepare_recommendation' THEN 'PrepareRecommendationProcessor'
      WHEN 'create_document' THEN 'CreateDocumentProcessor'
      WHEN 'produce_response' THEN 'ProduceResponseProcessor'
      ELSE type
    END;
  `,
  `
    CREATE TABLE runs_v3 (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      result TEXT, error TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      started_at INTEGER, finished_at INTEGER,
      UNIQUE (id, user_id)
    ) STRICT;
    INSERT INTO runs_v3 SELECT id, user_id, prompt, status, result, error,
      created_at, updated_at, started_at, finished_at FROM runs;

    CREATE TABLE run_steps_v3 (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      step_number INTEGER NOT NULL CHECK (step_number > 0),
      type TEXT NOT NULL,
      input_json TEXT NOT NULL CHECK (json_valid(input_json)),
      output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      error TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      available_at INTEGER NOT NULL,
      started_at INTEGER, finished_at INTEGER,
      lease_token TEXT, lease_expires_at INTEGER,
      UNIQUE (run_id, step_number),
      FOREIGN KEY (run_id, user_id) REFERENCES runs_v3(id, user_id) ON DELETE CASCADE,
      CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
      CHECK ((status = 'running') = (lease_token IS NOT NULL))
    ) STRICT;
    INSERT INTO run_steps_v3 SELECT s.id, s.run_id, r.user_id, s.step_number, s.type,
      s.input_json, s.output_json,
      CASE WHEN s.status = 'running' AND r.lease_token IS NULL THEN 'pending' ELSE s.status END,
      s.attempts, s.error, s.idempotency_key, s.created_at, s.created_at, s.started_at, s.finished_at,
      CASE WHEN s.status = 'running' THEN r.lease_token ELSE NULL END,
      CASE WHEN s.status = 'running' THEN r.lease_expires_at ELSE NULL END
      FROM run_steps s JOIN runs r ON r.id = s.run_id;
    DROP TABLE run_steps;
    DROP TABLE runs;
    ALTER TABLE runs_v3 RENAME TO runs;
    ALTER TABLE run_steps_v3 RENAME TO run_steps;
    CREATE INDEX runs_user_created ON runs(user_id, created_at DESC);
    CREATE INDEX steps_queue ON run_steps(status, available_at, lease_expires_at, created_at);
    CREATE UNIQUE INDEX one_open_step_per_run ON run_steps(run_id)
      WHERE status IN ('pending', 'running');
  `,

];

/** Version and schema changes commit together; concurrent openers serialize here. */
export function migrate(db: DatabaseSync, targetVersion = migrations.length): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion > migrations.length) throw new Error("Invalid migration target.");
    if (version > targetVersion) throw new Error("Database schema is newer than this application.");
    for (let index = version; index < targetVersion; index++) {
      db.exec(migrations[index]);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
