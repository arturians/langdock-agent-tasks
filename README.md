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

Open [http://localhost:3000](http://localhost:3000). A normal run takes approximately 15 seconds.

### Client identity

The page generates a UUID and stores it in local storage as `agent-user-id`.
The User ID controls let you copy it, use a manually entered UUID, or generate
a new one. Switching IDs clears the current run display; it does not delete
stored tasks. Switching is disabled while a run is active. Changes in another
tab reload the page to keep the identity consistent.

Run requests include `X-User-Id`; the API rejects missing or invalid UUIDs and
registers valid identities in SQLite. This is a prototype identity mechanism,
not authentication: anyone who knows an ID can use it.

Run requests now persist tasks under the supplied user ID. History endpoints
and the history UI are not connected yet. The storage layer provides
`findUserRun()` for owner-scoped reads; the fake external documents panel is
still a shared development view.

### SQLite storage

The SQLite storage layer uses the built-in `node:sqlite` module. The API creates
a run and its first step before starting the agent through the HTTP stream.

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

Execution is still attached to the HTTP request in this intermediate version.
A request abort marks the run failed; a process crash leaves the last committed
state on disk. Automatic recovery, worker leases, and idempotent external calls
will be added in subsequent steps. Steps interrupted before committing may run
again; external document creation is not yet safe to retry.

Run storage tests and static checks with:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

The timing can be changed during development:

```bash
AGENT_STEP_DELAY_MS=5000 AGENT_STEP_TRANSITION_DELAY_MS=1000 pnpm dev
```

To explore an interruption, begin a run and refresh the browser, stop the development server with `Ctrl+C`, or use **Simulate process crash** beside an active run. The crash control exits the backend process and is only available in development. Restart the application manually with `pnpm dev`.

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
