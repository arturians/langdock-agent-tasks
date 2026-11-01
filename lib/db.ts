import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.ts";

/** Open an independent connection. The caller owns and closes it. */
export function openDatabase(filename = process.env.AGENT_DB_PATH ?? path.join(process.cwd(), ".runtime", "agent.db")): DatabaseSync {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
    `);
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
