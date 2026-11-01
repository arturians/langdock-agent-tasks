# Platform Engineering Challenge: Long-Running Agent Execution

## Context

The starter application contains a small simulated AI agent.

A user submits a task, the backend performs several steps, and progress is shown in the browser. Some runs also interact with an external system.

The application was originally built for requests that finished within a few seconds. Agent tasks are now becoming more complex and may run for minutes or longer.

At the same time:

- Users refresh pages, close tabs, and lose network connectivity.
- We deploy new application versions frequently.
- Application processes occasionally stop unexpectedly.

In the current application, these situations can cause confusing or incorrect behavior.

## Your task

Improve the application so that long-running agent work behaves reliably under these conditions.

This is an application and backend systems challenge, not a deployment or infrastructure challenge. Focus on the behavior and structure of the application code when connections and processes disappear. Assume the surrounding platform will eventually restart a terminated process. Kubernetes configuration, process supervisors, CI/CD pipelines, and cloud deployment are outside the scope of the prototype.

We want you to decide:

- Which problems are most important to address
- What behavior users should experience
- How the application should be structured
- What guarantees are realistic
- What to implement within the available time

We intentionally do not prescribe any particular architecture, infrastructure component, or library.

During the review, we will start a run, interrupt the browser or backend, start the application again, and inspect what happens. Your implementation should make these scenarios meaningfully more reliable and understandable than they are in the starter application.

## Scenarios

Your submission should allow us to explore scenarios such as:

1. Starting an agent run
2. Refreshing or closing the browser while it is running
3. Interrupting the backend during execution
4. Starting the application again
5. Inspecting what happened
6. Continuing to use the application

The starter includes a development control for terminating the backend process. You can change or replace this mechanism if it no longer fits your implementation.

One agent step interacts with a simulated external system. Its behavior is intentionally simple.

## Deliverables

### Functional prototype

Implement a working version of your approach.

Prioritize the parts that best demonstrate your technical decisions. The prototype does not need to cover every production concern.

### Technical explanation

Complete [`DESIGN.md`](./DESIGN.md) with a short explanation of:

- The approach you took
- The most important decisions you made
- The behavior your prototype supports
- Important limitations or unresolved cases
- How you would develop the system further

Include an architecture diagram in any readable format. Clearly distinguish between what you implemented and what you would propose for a production system.

### Running instructions

Document how to start the application, run the relevant scenarios, and execute any tests you added.

## Getting started

Requirements: Node.js 24.x and pnpm 11.19.0.

```bash
pnpm install
pnpm dev
```

In a second terminal, from the same project directory, start the worker:

```bash
pnpm worker
```

Open [http://localhost:3000](http://localhost:3000). A normal run takes approximately 15 seconds.

### Client identity

The page generates a UUID and stores it in local storage as `agent-user-id`.
The User ID controls let you copy it, use a manually entered UUID, or generate
a new one. Switching IDs clears the current run display; it does not delete
stored tasks. Switching is disabled only while submitting a task. Changes in another
tab reload the page to keep the identity consistent.

Run requests include `X-User-Id`; the API rejects missing or invalid UUIDs and
registers valid identities in SQLite. This is a prototype identity mechanism,
not authentication: anyone who knows an ID can use it.

`GET /api/runs` lists only the current user's tasks, newest first. The page
refreshes history every 1.5 seconds and the selected active task every 750 ms.
Select any task to inspect its progress, saved result, or failure. New tasks can
be submitted while other tasks are executing; the worker processes its queue.

The selected task ID is stored separately for each user as
`agent-selected-run:<userId>`. Reloading or reopening the page restores that task
and resumes observation. If the saved task is unavailable, the latest owned task
is selected. Switching user IDs cancels observation requests and displays that
user's history without stopping execution. Switching back restores the selection.
Temporary connection errors are displayed separately from task failure and reads
retry automatically. The fake external documents panel is still a shared
development view; user IDs do not provide authentication.

### SQLite storage

The SQLite storage layer uses the built-in `node:sqlite` module. The API creates
a run and its first step, then returns `202 { runId }`. A separate worker
executes tasks. The page polls `GET /api/runs/[id]` with its user ID.

`openDatabase()` in `lib/db.ts` creates `.runtime/agent.db` and applies versioned
migrations automatically. Connections enable foreign keys, WAL journaling,
`synchronous=FULL`, and a five-second lock wait. `.runtime/` is excluded from Git.
Timestamps are Unix milliseconds.

The schema contains `users`, `runs`, and `run_steps`. `createRun()` in
`lib/run-store.ts` atomically creates the user if needed, a queued run, and only
its first step. Each step handler returns JSON output and either a next step
with its input or a final result. `completeStep()` saves the output and creates
the continuation (or completes the run) in one transaction. The executor reads
the next unfinished step from storage; completed steps are skipped. The sample
handlers still follow the original five-step scenario, but the executor has no
predefined list or total step count.

Step processor classes live in `lib/agent/steps/` and implement `StepProcessor`.
`lib/agent/processors.ts` explicitly registers them in `StepRegistry`, which
rejects duplicate and unknown types. The executor selects processors by the
stored step type and has no action-specific branching. Each processor owns its
title, input validation, output, and continuation; the registry order does not
determine execution order. Tests can inject a different registry into `runAgent()`.
Processors return `output` and `nextProcessor` (a class name such as
`SearchInformationProcessor.name`, or `null` to finish). Output becomes the next
processor's input. A final processor also returns the user-facing `result`.
Class names are persisted as step types: renaming them requires a migration.
Migration 2 maps the original step identifiers to processor class names.
Each processor explicitly preserves its runtime class name with
`Object.defineProperty` so Next.js minification cannot change the identifiers
shared by the API and the unbundled worker.

`StepExecutionService` coordinates a single step: it loads and starts the step,
selects and executes its processor outside a transaction, validates the next
processor, and commits the result through storage before emitting completion.
`runAgent()` repeats this operation until the final result and delegates failure
recording to the service. Storage owns SQL and atomic transactions and never
calls processors.

Workers atomically claim queued tasks or running tasks whose lease has expired.
A lease lasts 15 seconds and is renewed every 5 seconds. Every step start,
completion, and failure write checks the token and expiry inside its transaction.
A stale worker cannot commit after losing ownership. SIGINT/SIGTERM interrupts
execution and releases the lease; a hard crash requires waiting for expiry.
The next worker skips completed steps and retries an unfinished step. Processor
errors mark a task failed; automatic retries of application errors are not added.

Both processes must use the same working directory and persistent local disk.
`AGENT_DB_PATH` can override the database file for both processes. Closing the
browser or stopping Next.js does not stop the worker. The page retries reads after a temporary API outage and restores the selected
task after a full page refresh.

### Idempotent external documents

The fake external system uses a separate `.runtime/fake-external.db` SQLite file
(override with `FAKE_EXTERNAL_DB_PATH` for both processes). It uses the default
rollback journal, `synchronous=FULL`, and a five-second lock wait. Its transaction
is independent of the agent database, preserving the external-call crash window.

The executor passes the stored step's `idempotency_key` to its processor.
Document creation checks that unique key and inserts within one transaction.
Retries with identical input return the original document, including its ID and
creation time. Reusing a key with different input fails. Concurrent processes
using the same key produce one document. After a crash following external commit
but preceding step commit, recovery repeats the call with the same key and saves
the existing document's ID.

On first initialization, documents from the neighboring
`fake-external-actions.json` are imported once; the JSON remains as a backup.
Legacy documents have no idempotency key, so this guarantee applies to calls
made by the new implementation, not old calls interrupted before this upgrade.
The development **Reset** action deletes documents and their keys; replaying an
unfinished task after reset can create a new document. Use reset after runs finish.

Run storage tests and static checks with:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Run the HTTP recovery test against a production build with:

```bash
pnpm test:integration
```

It opens a temporary localhost port, starts its own API and worker, uses isolated
temporary databases, stops and restarts the API, and verifies task completion,
history, document creation, and user access boundaries. It does not use your
development databases. The unit and process tests in `pnpm test` also use
temporary files or in-memory databases.

### Review scenarios

Start `pnpm dev` and `pnpm worker` in separate terminals in this directory.
For easier observation, run the worker with the slower timings below.

| Scenario | Action | Expected behavior |
| --- | --- | --- |
| Browser refresh or close | Submit a task, refresh or reopen the page | The same user and selected task are restored; execution continues |
| Switch tasks | Submit two tasks and select either history entry | Observation changes; both tasks remain queued or executing |
| Switch users | Copy the current ID, choose New ID, then enter the old ID | The new ID has separate history; the old ID restores its tasks |
| API interruption | Use Simulate API crash, or stop `pnpm dev`; restart it | The worker continues; polling resumes when the API returns |
| Worker interruption | Stop `pnpm worker` with Ctrl+C, then restart it | Unfinished work resumes; committed steps are skipped |
| Worker hard crash | Send SIGKILL to the worker PID, then restart it | Recovery waits for the old lease to expire, up to 15 seconds |
| External-call crash window | Run `pnpm test` | A subprocess exits after external commit; recovery reuses the original document |
| Inspect completion | Select a completed or failed history entry | Saved progress and final result or error remain available |

If a task stays queued, check that the worker is running against the same
database as the API. Progress is reconstructed from saved step state, so it is
not a log of every retry. Development Reset clears the shared fake external
system; use it after tasks finish.

See [DESIGN.md](./DESIGN.md) for the implemented architecture, guarantees,
limitations, and proposed production changes.

The timing can be changed during development:

```bash
AGENT_STEP_DELAY_MS=5000 AGENT_STEP_TRANSITION_DELAY_MS=1000 pnpm worker
```

To explore recovery, start a task, stop the worker with `Ctrl+C`, and run
`pnpm worker` again. For a hard crash, send SIGKILL to the worker process and
restart it; recovery starts after the old lease expires (up to 15 seconds).
Stopping the API with `Ctrl+C` or **Simulate API crash** leaves the worker running;
restart the API with `pnpm dev`. The integration test uses SIGKILL against a real
worker process and advances its stored lease expiry to avoid a 15-second test wait.

The starter's current structure is summarized in [`docs/STARTER_ARCHITECTURE.md`](./docs/STARTER_ARCHITECTURE.md).

## Scope

We expect you to spend approximately **3–4 hours**.

You are not expected to implement:

- Kubernetes or cloud infrastructure
- CI/CD configuration
- Authentication or multi-tenancy
- A polished frontend
- A complete production system
- Every possible failure scenario

You may add, remove, or replace libraries. You may also restructure the application.

AI development tools are allowed and encouraged. You remain responsible for understanding and explaining your submission.

## What we evaluate

We are interested in:

- How you investigate and frame the problem
- The architecture and tradeoffs you choose
- The behavior of the working prototype
- How you reason about unexpected interruptions
- The clarity and maintainability of the implementation
- Your ability to explain limitations and possible next steps

We do not evaluate candidates based on choosing a particular technology.

A submission focused primarily on deployment configuration or process management will not satisfy the challenge.

## Submission

Create a private repository from this template and invite the GitHub users named in your interview email. Submit the repository at least the evening before your review call.
