# Starter architecture

The starter intentionally couples the agent lifecycle to a single HTTP request and client connection.

```mermaid
sequenceDiagram
    participant Browser
    participant API as Next.js POST /api/runs
    participant Agent as In-process agent loop
    participant Tool as Fake external system

    Browser->>API: Start run and keep HTTP connection open
    API->>Agent: Execute inside request process
    Agent-->>Browser: Stream transient progress events
    Agent->>Tool: Create document on disk
    Agent-->>Browser: Stream final result
```

Run progress is sent through the active response stream. The simulated external system stores created documents in `.runtime/fake-external-actions.json` so they remain available when the application is started again.

The starter does not prescribe how it should be changed. The assignment is to investigate its behavior under the supplied scenarios, choose an approach, and explain the decisions made.
