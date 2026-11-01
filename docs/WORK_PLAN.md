# Implementation plan

Each stage is reviewed before committing. Commit and proceed only after explicit
user approval.

1. SQLite schema and storage for users, runs, and dynamically generated steps.
   Committed: `cf932b7`.
2. Client user identity and owner-scoped task lookup.
   Committed: `3ab8a10`.
3. Persist step output and atomically create the next step or finish the run.
   Use separate processor classes and an explicit registry keyed by class name.
   Committed: `fe30a6b`.
4. Extract a step execution service before adding the worker.
   The service selects a processor, marks the step started, executes it outside
   a database transaction, and saves its output and continuation through storage.
   It also coordinates failure recording. The run loop delegates step execution
   to this service. Storage remains responsible for SQL and transaction boundaries;
   it must not select or execute processors. This coordination previously lived
   in `runAgent()`; storage does not call processors.
   Committed: `58da1f6`.
5. Queue worker, leases, and recovery after process interruption.
   Committed: `afaa15c`. Includes minimal owner-scoped progress
   polling so the current UI works with asynchronous submission.
6. User task history and progress restoration in the UI.
   Committed: `7df58c7`.
7. Idempotent external document creation.
   Committed: `5df3e23`.
8. Recovery scenario tests and final README / DESIGN documentation.
   Reviewed and approved for commit.
