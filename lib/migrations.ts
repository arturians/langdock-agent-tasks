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
];

/** Version and schema changes commit together; concurrent openers serialize here. */
export function migrate(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version > migrations.length) throw new Error("Database schema is newer than this application.");
    for (let index = version; index < migrations.length; index++) {
      db.exec(migrations[index]);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
