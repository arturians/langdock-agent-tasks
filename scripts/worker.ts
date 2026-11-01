import { openDatabase } from "../lib/db.ts";
import { runWorker } from "../lib/worker.ts";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const db = openDatabase();
console.log("Agent worker started. Press Ctrl+C to stop.");
runWorker(db, controller.signal)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
