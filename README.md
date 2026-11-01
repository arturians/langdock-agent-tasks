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

Requirements: Node.js 20 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). A normal run takes approximately 15 seconds.

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
