# Prompt Guesser — Domain Architecture & Developer Guide

> **Goal:** Enable multiple contributors to implement round/game commands in a platform-agnostic, testable, and concurrency-safe way. This guide defines the domain boundaries, file layout, coding patterns, and how to add new features without coupling to any specific runtime (Cloudflare Workers, Next.js, AWS Lambda).

---

## 1) Core Principles

- **Domain-first, runtime-agnostic.** All game rules live in the domain. No runtime APIs (no fetch, timers, env) inside domain code.
- **Commands as classes.** Each user/system action is a class with an `execute(ctx)` method. All commands go through a single `dispatchCommand` entry for logging/auditing.
- **Event-driven timeouts.** We never poll or sleep. Commands carry their own timestamp (`TimePoint`) and the runtime schedules phase transitions externally; the domain remains deterministic and wall-clock agnostic.
- **Round-focused aggregate.** We model one **Round** (not the entire multi-round game) as the main aggregate (`RoundState`).
- **Concurrency-conscious persistence.** Storage adapters expose atomic mutations (e.g., `appendPrompt`, `appendVote`) that return up-to-date snapshots. A general `saveRoundState` exists for phase transitions/finalize; adapters choose optimistic or diff-merge internally.
- **Portable ports.** Domain depends only on ports: `RoundGateway`, `MessageBus`, `ImageGenerator`, `Logger` (typedefs for `RoundId`, `PlayerId`, `TimePoint`, `RoundPhase`).

---

## 2) Directory Layout

```
/src
  /domain
    /typedefs.ts            # RoundId, PlayerId, TimePoint, RoundPhase
    /ports
      RoundGateway.ts       # RoundState + gateway interfaces
      MessageBus.ts
      ImageGenerator.ts
      Logger.ts
      index.ts              # barrel export for ports & typedefs
    /entities
      RoundRules.ts         # pure helpers (validation, shuffling, scoring)
    /commands
      Command.ts            # base class + CommandContext
      dispatchCommand.ts    # single entrypoint wrapper (logging, errors)
      SubmitPrompt.ts       # active player submits real prompt
      SubmitDecoy.ts        # non-active player submits decoy (optional alias of SubmitPrompt)
      SubmitVote.ts         # player votes by index
      PhaseTimeout.ts       # system-triggered timeout for a phase
      FinalizeScoring.ts    # compute & persist scores, finish round
    /tests
      unit/                 # pure unit tests for rules/helpers
      contract/             # gateway/message bus contract tests
  /adapters
    /round-gateway
      dynamo.ts             # DynamoDB implementation (atomic updates)
      postgres.ts           # SQL/JSONB implementation
      memory.ts             # in-memory (for tests/dev)
    /message-bus
      ws.ts                 # WebSocket/pubsub adapter
      noop.ts               # no-op bus for tests
    /image-generator
      openai.ts             # example external image generation
```

---

## 3) Canonical Domain Types & Ports

### 3.1 Typedefs (import from `domain/typedefs`)

- `type RoundId = string`
- `type PlayerId = string`
- `type TimePoint = number` (ms since epoch)
- `type RoundPhase = "prompt" | "guessing" | "voting" | "scoring" | "finished"`

### 3.2 RoundState (authoritative round snapshot)

```ts
export interface RoundState {
  id: RoundId;
  players: PlayerId[];
  activePlayer: PlayerId;
  phase: RoundPhase;

  prompts?: Record<PlayerId, string>;     // set during guessing (active player's entry is real prompt)
  shuffleOrder?: number[];                // set at transition to voting
  votes?: Record<PlayerId, number>;       // set during voting (index into shuffled prompts)
  scores?: Record<PlayerId, number>;      // set at scoring

  startedAt: TimePoint;
  imageUrl?: string;
  finishedAt?: TimePoint;
}
```

The optional `imageUrl` is populated once the real prompt has been accepted and
an image has been generated for the round. Before the guessing phase begins the
field will be `undefined`, allowing adapters to distinguish rounds that have
not yet produced a shareable image.

### 3.3 RoundGateway (persistence boundary)

```ts
export interface PromptAppendResult {
  inserted: boolean; // false when submission was a duplicate
  prompts: Record<PlayerId, string>;
}

export interface VoteAppendResult {
  inserted: boolean;
  votes: Record<PlayerId, number>;
}

export interface RoundGateway {
  loadRoundState(roundId: RoundId): Promise<RoundState>;
  saveRoundState(state: RoundState): Promise<void>; // adapters choose optimistic or diff-merge

  // Atomic mutations that return updated snapshots to avoid update-then-read
  appendPrompt(roundId: RoundId, playerId: PlayerId, prompt: string): Promise<PromptAppendResult>;
  appendVote(roundId: RoundId, playerId: PlayerId, promptIndex: number): Promise<VoteAppendResult>;
  countSubmittedPrompts(roundId: RoundId): Promise<number>;

  startNewRound(
    players: PlayerId[],
    activePlayer: PlayerId,
    startedAt: TimePoint,
  ): Promise<RoundState>;
}
```

### 3.4 MessageBus

```ts
export interface MessageBus {
  publish(channel: string, event: object): Promise<void>;
}
```

### 3.5 ImageGenerator (placeholder if/when needed)

```ts
export interface ImageGenerator {
  generate(prompt: string, options?: Record<string, unknown>): Promise<string>;
}
```

### 3.6 Logger (optional, but useful in dispatcher)

```ts
export interface Logger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  debug?(msg: string, meta?: unknown): void;
}
```

### 3.7 Scheduler (runtime-managed timeouts)

```ts
export interface Scheduler {
  scheduleTimeout(
    roundId: RoundId,
    phase: PhaseTimeout["phase"],
    delayMs: number,
  ): Promise<void>;
}
```

The scheduler belongs to the infrastructure/runtime layer. When the domain transitions between phases, the surrounding
application decides whether to queue a `PhaseTimeout` command using this port. The adapter determines when to fire the timeout
based on its notion of time, keeping wall-clock orchestration out of the pure domain logic.

---

## 4) Command Model

### 4.1 Base class & context

```ts
// Command.ts
export interface CommandContext {
  gateway: RoundGateway;
  bus: MessageBus;
  imageGenerator: ImageGenerator;
  config: GameConfig;
  scheduler: Scheduler;
  logger?: Logger;
}

export abstract class Command {
  abstract readonly type: string;
  abstract readonly at: TimePoint; // when the action occurred
  abstract execute(ctx: CommandContext): Promise<void>;
}
```

### 4.2 Central dispatcher

```ts
// dispatchCommand.ts
export async function dispatchCommand(cmd: Command, ctx: CommandContext): Promise<void> {
  const started = Date.now();
  try {
    ctx.logger?.info(`[CMD] ${cmd.type}`, { cmd });
    await cmd.execute(ctx);
    ctx.logger?.info(`[CMD OK] ${cmd.type}`, { ms: Date.now() - started });
  } catch (err) {
    ctx.logger?.error(`[CMD ERR] ${cmd.type}`, { err });
    throw err;
  }
}
```

---

## 5) Round Rules — Pure Helpers (No I/O)

Put deterministic logic here so multiple command implementations can reuse it:

- `assertPhase(state, expected)`
- `isPlayer(state, playerId)`
- `hasSubmittedPrompt(state, playerId)`
- `allPromptsSubmitted(state)`
- `generateShuffle(state): number[]` and helper accessors for prompt order
- `calculateScores(state): Record<PlayerId, number>`

These never touch adapters; they just process inputs and return outputs.

---

## 6) Reference Commands (Patterns)

The production commands in `src/domain/commands` follow a consistent structure. At a high level:

- **SubmitPrompt**
  - Validates the round is in the `prompt` phase and that the submitting player matches `activePlayer`.
  - Stores the prompt via `appendPrompt`, generates the shared image, updates the round to the `guessing` phase, and emits
    `ImageGenerated` / `PhaseChanged` events.
  - The runtime inspects the resulting phase and schedules the next `PhaseTimeout` using the configured guessing duration.

- **SubmitDecoy**
  - Ensures the round is in `guessing`, the player belongs to the round, and is not the active player.
  - Persists the decoy; once every player has submitted a prompt the command transitions the round to `voting`, shuffling prompts
    deterministically through the gateway and publishing `PromptsReady` / `PhaseChanged` events.
  - Runtime scheduling logic can observe the phase change and queue the next timeout.

- **SubmitVote**
  - Checks `voting` phase invariants and records the vote atomically. When all eligible voters have cast a vote it calls
    `finalizeRound`, which computes scores, enters `scoring`, and finally marks the round `finished` while emitting the
    corresponding events.

- **PhaseTimeout**
  - Loads the current round snapshot and exits immediately if the stored phase no longer matches the expected phase (idempotent).
  - For the `prompt` timeout, it awards zero scores to everyone and finishes the round. For the `guessing` timeout it promotes the
    round to `voting` using whatever prompts are available. For the `voting` timeout it delegates to `finalizeRound`.
  - No wall-clock comparisons occur inside the command—the runtime is responsible for dispatching it at the appropriate time.

> **Note:** Each transition persists the updated snapshot exactly once and emits domain events. Use the existing command
> implementations in the repository as the source of truth.

---

## 7) Storage Adapter Guidance

- **Atomicity:** `appendPrompt` and `appendVote` must be atomic and **idempotent** (same player submitting twice should not change stored state).
- **Return values:** These methods must return **post-update snapshots** to avoid update-then-read round trips.
- **`saveRoundState`:** Implement optimistic concurrency or diff-merge internally; the domain should not carry versions.
- **Static mutability:** Treat fields like `prompts`, `votes`, `phase`, `shuffleOrder`, `scores`, `finishedAt` as mutable; others are immutable after creation.
- **Serialization:** Optional fields may be absent in storage; default to empty objects/arrays in adapters when reading if needed.

---

## 8) Message Bus Guidance

- Channels: `round:{roundId}` for all player-facing events.
- Events to publish at minimum:
  - `PlayerPromptSubmitted` (optional)
  - `PlayerVoteSubmitted` (optional)
  - `PhaseChanged`
  - `RoundFinished`
- Events are **notifications** only. Game authority remains in storage + domain logic.

---

## 8.5 Timeout Scheduling Lifecycle

**Purpose:**
Explain *when and how* timeouts are scheduled after removing `*Deadline` fields from the domain state.
All scheduling now happens through the **`Scheduler` port**, keeping the domain deterministic and wall-clock agnostic.

---

### 1. Principles

* **Domain purity:** No command ever creates or measures real time.
* **Runtime-managed timing:** The `Scheduler` port is the only layer that interacts with the clock or timers.
* **Idempotency:** Each `PhaseTimeout` command checks the current phase before acting, so duplicate or delayed executions are harmless.
* **Event isolation:** `MessageBus` events (e.g. `PhaseChanged`) are for the frontend only; the runtime never listens to them to drive timeouts.

---

### 2. When to Schedule Timeouts

Timeouts are scheduled **once per phase**, immediately after each phase transition:

| Phase entered          | Timeout scheduled          | Where it happens           |
| ---------------------- | -------------------------- | -------------------------- |
| `prompt`               | `PhaseTimeout("prompt")`   | in `StartNewRound.execute` |
| `guessing`             | `PhaseTimeout("guessing")` | in `transitionToGuessing`  |
| `voting`               | `PhaseTimeout("voting")`   | in `transitionToVoting`    |
| `scoring` / `finished` | none                       | end of round               |

Each call uses the configured duration from `GameConfig`, e.g.:

```ts
await scheduler.scheduleTimeout(round.id, "guessing", config.guessingDurationMs);
```

---

### 3. Runtime Responsibilities

* **Startup / recovery:** On service start, the runtime may inspect persisted rounds and schedule any pending timeouts according to their current phase.
* **Dispatch:** When the delay elapses, the scheduler dispatches a `PhaseTimeout` command whose `at` timestamp is filled by the scheduler itself.
* **No rescheduling:** Normal flow requires no additional rescheduling. Only restarts or crash recovery trigger re-scheduling.

---

### 4. Testing Guidance

In tests, use the `InMemoryScheduler` adapter:

```ts
const scheduler = new InMemoryScheduler(dispatch);
await scheduler.scheduleTimeout("round-1", "prompt", 2000);
await scheduler.runFor(2000); // triggers the command deterministically
```

This allows complete control over virtual time without fake timers or real delays.

---

### 5. Summary

* Timeouts are **scheduled externally**, never stored in state.
* Each new phase automatically triggers its own timeout.
* Commands remain deterministic, and duplicated schedules are safe.
* The runtime hosts the scheduler; the domain defines only *when* a timeout should exist.

---

## 9) How to Implement a New Command (Checklist)

1. **Decide intent and phase.** Which phase accepts this action? What invariants apply?
2. **Create command class** in `/domain/commands`, extending `Command` and adding required fields.
3. **Validate** inside `execute`: phase, actor permissions, indices, and other state-driven invariants.
4. **Use gateway** methods for persistence. Avoid read-after-write by relying on returned snapshots.
5. **Advance phase** if needed, then `saveRoundState` once per transition.
6. **Publish events** via `MessageBus` to notify clients.
7. **Write tests**: unit tests for `RoundRules` logic; integration with `memory` gateway adapter.

---

## 10) Testing Strategy

- **Unit tests (pure):** `RoundRules` (shuffling, scoring, validations) with fixed seeds and snapshots.
- **Command tests:** Use `memory` gateway + `noop` bus to verify:
  - valid/invalid transitions
  - phase-driven invariants and event sequencing
  - idempotency (double submit doesn’t modify stored state)
  - concurrency (simulate interleaving by ordering promises)
- **Adapter contract tests:** Same test suite should pass for `memory`, `dynamo`, and `postgres` implementations.

---

## 11) Code Style & Conventions

- Keep commands **small** and **deterministic**. All side effects go through ports.
- Never use `Date.now()` inside commands — pass `at` from caller.
- Avoid throwing raw strings; throw `Error` with clear messages.
- Prefer pure helpers in `RoundRules.ts` for reusable computations.
- Document each command with **phase**, **preconditions**, **effects**, **events**.

---

## 12) Future Extensions (Non-blocking)

- Deterministic shuffling with seeded RNG (store seed for auditability).
- Formal scoring rules in `RoundRules.calculateScores` (and snapshots for balance changes).
- Game aggregate to link multiple `RoundState`s with a stable `gameId`.
- Replay tooling: log commands and re-run via `dispatchCommand` for debugging.

---

**This guide is the source of truth for domain contributions.** If a change affects these contracts (ports/types), update this document first, then proceed with implementation PRs.

