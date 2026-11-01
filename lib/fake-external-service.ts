import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExternalAction } from "./types.ts";

type CreateDocumentInput = {
  runId: string;
  title: string;
  content: string;
  idempotencyKey: string;
};

function defaultFilename(): string {
  return process.env.FAKE_EXTERNAL_DB_PATH ?? path.join(process.cwd(), ".runtime", "fake-external.db");
}

/** Separate durable system: its transaction cannot include the agent database. */
export class FakeExternalService {
  private readonly db: DatabaseSync;

  constructor(filename = defaultFilename()) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    try {
      // Keep the default rollback journal: no journal-mode upgrade race on first open.
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;");
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const version = this.db.prepare("PRAGMA user_version").get()!.user_version as number;
        if (version > 1) throw new Error("External database schema is newer than this application.");
        if (version === 0) {
          this.db.exec(`CREATE TABLE documents (
            id TEXT PRIMARY KEY NOT NULL,
            runId TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            idempotency_key TEXT UNIQUE
          ) STRICT;`);
          // Import once, retaining the old file as a backup. Legacy calls had no keys.
          if (filename !== ":memory:") this.importLegacy(path.join(path.dirname(filename), "fake-external-actions.json"));
          this.db.exec("PRAGMA user_version = 1");
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private importLegacy(filename: string): void {
    let text: string;
    try { text = readFileSync(filename, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const documents: unknown = JSON.parse(text);
    if (!Array.isArray(documents)) throw new Error("Invalid legacy external documents.");
    const insert = this.db.prepare("INSERT INTO documents (id, runId, title, content, createdAt) VALUES (?, ?, ?, ?, ?)");
    for (const document of documents) {
      if (!document || ![document.id, document.runId, document.title, document.content, document.createdAt].every(value => typeof value === "string")) {
        throw new Error("Invalid legacy external document.");
      }
      insert.run(document.id, document.runId, document.title, document.content, document.createdAt);
    }
  }

  createDocument(input: CreateDocumentInput): ExternalAction {
    if (!input.idempotencyKey.trim()) throw new Error("An idempotency key is required.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare(`SELECT id, runId, title, content, createdAt FROM documents
        WHERE idempotency_key = ?`).get(input.idempotencyKey) as ExternalAction | undefined;
      if (existing && (existing.runId !== input.runId || existing.title !== input.title || existing.content !== input.content)) {
        throw new Error("Idempotency key reused with different document input.");
      }
      const document = existing ?? {
        id: crypto.randomUUID(), runId: input.runId, title: input.title,
        content: input.content, createdAt: new Date().toISOString(),
      };
      if (!existing) this.db.prepare(`INSERT INTO documents (id, runId, title, content, createdAt, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?)`).run(document.id, document.runId, document.title, document.content, document.createdAt, input.idempotencyKey);
      this.db.exec("COMMIT");
      return { ...document };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listDocuments(): ExternalAction[] {
    const documents = this.db.prepare("SELECT id, runId, title, content, createdAt FROM documents ORDER BY createdAt, id").all() as ExternalAction[];
    return documents.map(document => ({ ...document }));
  }

  resetDocuments(): void { this.db.exec("DELETE FROM documents"); }
  close(): void { this.db.close(); }
}

function withService<T>(operation: (service: FakeExternalService) => T): T {
  const service = new FakeExternalService();
  try { return operation(service); } finally { service.close(); }
}

export async function createDocument(input: CreateDocumentInput): Promise<ExternalAction> {
  return withService(service => service.createDocument(input));
}

export async function listDocuments(): Promise<ExternalAction[]> {
  return withService(service => service.listDocuments());
}

export async function resetDocuments(): Promise<void> {
  withService(service => service.resetDocuments());
}
