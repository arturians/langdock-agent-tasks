# Implementation plan

Each stage is reviewed before committing. Commit and proceed only after explicit
user approval.

1. SQLite schema and storage for users, runs, and dynamically generated steps.
   Committed: `cf932b7`.
2. Client user identity and owner-scoped task lookup.
   Committed: `3ab8a10`.
3. Persist step output and atomically create the next step or finish the run.
   Use separate processor classes and an explicit registry keyed by class name.
   Implemented, awaiting review and commit.
4. Extract a step execution service before adding the worker.
   The service selects a processor, marks the step started, executes it outside
   a database transaction, and saves its output and continuation through storage.
   It also coordinates failure recording. The run loop delegates step execution
   to this service. Storage remains responsible for SQL and transaction boundaries;
   it must not select or execute processors. Currently `runAgent()` performs this
   coordination; storage does not call processors.
5. Queue worker, leases, and recovery after process interruption.
6. User task history and progress restoration in the UI.
7. Idempotent external document creation.
8. Recovery scenario tests and final README / DESIGN documentation.
