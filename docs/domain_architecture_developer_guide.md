# Prompt Guesser — Domain Architecture & Developer Guide

> **Goal:** Enable multiple contributors to implement round/game commands in a platform-agnostic, testable, and concurrency-safe way. This guide defines the domain boundaries, file layout, coding patterns, and how to add new features without coupling to any specific runtime (Cloudflare Workers, Next.js, AWS Lambda).

---

## 1) Core Principles

- **Domain-first, runtime-agnostic.** All game rules live in the domain. No runtime APIs (no fetch, timers, env) inside domain code.
- **Commands as classes.** Each user/system action is a class with an `execute(ctx)` method. All commands go through a single `dispatchCommand` entry for logging/auditing.
- **Event-driven time.** We never poll or sleep. Commands carry their own timestamp (`TimePoint`) and deadlines are explicit in state.
- **Round-focused aggregate.** We model one **Round** (not the entire multi-round game) as the main aggregate (`RoundState`).
- **Concurrency-conscious persistence.** Storage adapters expose atomic mutations (e.g., `appendPrompt`, `appendVote`) that return useful counts. A general `saveRoundState` exists for phase transitions/finalize; adapters choose optimistic or diff-merge internally.
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
  shuffledPrompts?: string[];             // set at transition to voting
  votes?: Record<PlayerId, number>;       // set during voting (index into shuffledPrompts)
  scores?: Record<PlayerId, number>;      // set at scoring

  startedAt: TimePoint;
  promptDeadline?: TimePoint;
  guessingDeadline?: TimePoint;
  votingDeadline?: TimePoint;
  finishedAt?: TimePoint;
}
```

### 3.3 RoundGateway (persistence boundary)

```ts
export interface PromptAppendResult {
  count: number; // total prompts stored after mutation
  inserted: boolean; // false when submission was a duplicate
}

export interface RoundGateway {
  loadRoundState(roundId: RoundId): Promise<RoundState>;
  saveRoundState(state: RoundState): Promise<void>; // adapters choose optimistic or diff-merge

  // Atomic mutations that return updated counts to avoid update-then-read
  appendPrompt(roundId: RoundId, playerId: PlayerId, prompt: string): Promise<PromptAppendResult>;
  appendVote(roundId: RoundId, playerId: PlayerId, promptIndex: number): Promise<number>;
  countSubmittedPrompts(roundId: RoundId): Promise<number>;

  startNewRound(players: PlayerId[], activePlayer: PlayerId): Promise<RoundState>;
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

---

## 4) Command Model

### 4.1 Base class & context

```ts
// Command.ts
export interface CommandContext {
  gateway: RoundGateway;
  bus: MessageBus;
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
- `shufflePrompts(state): string[]` (use deterministic seed if needed)
- `calculateScores(state): Record<PlayerId, number>`

These never touch adapters; they just process inputs and return outputs.

---

## 6) Reference Commands (Patterns)

### 6.1 SubmitPrompt (real prompt by active player)

```ts
export class SubmitPrompt extends Command {
  readonly type = "SubmitPrompt" as const;
  constructor(
    public readonly roundId: RoundId,
    public readonly playerId: PlayerId,
    public readonly prompt: string,
    public readonly at: TimePoint
  ) { super(); }

  async execute({ gateway, bus }: CommandContext): Promise<void> {
    const state = await gateway.loadRoundState(this.roundId);
    // Validate
    if (state.phase !== "prompt") throw new Error("Not in prompt phase");
    if (state.activePlayer !== this.playerId) throw new Error("Only active player can submit real prompt");

    // Persist atomically & get updated count
    const { count: promptCount, inserted } = await gateway.appendPrompt(
      this.roundId,
      this.playerId,
      this.prompt,
    );

    if (!inserted) return; // already persisted elsewhere; idempotent command

    // If prompt phase is satisfied (active player submitted), advance to guessing
    if (promptCount >= 1) {
      state.phase = "guessing";
      // guessingDeadline should already be set at round creation; keep it as-is
      await gateway.saveRoundState(state);
      await bus.publish(`round:${state.id}`, { type: "PhaseChanged", phase: state.phase, at: this.at });
    }
  }
}
```

### 6.2 SubmitDecoy (decoy prompt by non-active players)

```ts
export class SubmitDecoy extends Command {
  readonly type = "SubmitDecoy" as const;
  constructor(
    public readonly roundId: RoundId,
    public readonly playerId: PlayerId,
    public readonly prompt: string,
    public readonly at: TimePoint
  ) { super(); }

  async execute({ gateway, bus }: CommandContext): Promise<void> {
    const state = await gateway.loadRoundState(this.roundId);
    if (state.phase !== "guessing") throw new Error("Not in guessing phase");
    if (state.activePlayer === this.playerId) throw new Error("Active player does not submit a decoy");
    if (state.guessingDeadline && this.at > state.guessingDeadline) throw new Error("Guessing deadline passed");

    const { count, inserted } = await gateway.appendPrompt(
      this.roundId,
      this.playerId,
      this.prompt,
    );
    if (!inserted) return; // ignore duplicate decoys

    const required = state.players.length - 1; // everyone except active player

    const allSubmitted = count >= required;
    const timedOut = !!state.guessingDeadline && this.at >= state.guessingDeadline;

    if (allSubmitted || timedOut) {
      // Produce shuffledPrompts in-memory and persist via saveRoundState
      const prompts = { ...(state.prompts ?? {}), [this.playerId]: this.prompt };
      const all = [prompts[state.activePlayer]!, ...Object.entries(prompts)
        .filter(([pid]) => pid !== state.activePlayer)
        .map(([, p]) => p)];
      // TODO: replace with RoundRules.shufflePrompts(prompts) for deterministic shuffling
      state.prompts = prompts;
      state.shuffledPrompts = all.sort(() => Math.random() - 0.5);
      state.phase = "voting";
      await gateway.saveRoundState(state);
      await bus.publish(`round:${state.id}`, { type: "PhaseChanged", phase: state.phase, at: this.at });
    }
  }
}
```

### 6.3 SubmitVote (vote by any player)

```ts
export class SubmitVote extends Command {
  readonly type = "SubmitVote" as const;
  constructor(
    public readonly roundId: RoundId,
    public readonly playerId: PlayerId,
    public readonly promptIndex: number,
    public readonly at: TimePoint
  ) { super(); }

  async execute({ gateway, bus }: CommandContext): Promise<void> {
    const state = await gateway.loadRoundState(this.roundId);
    if (state.phase !== "voting") throw new Error("Not in voting phase");
    if (!state.shuffledPrompts || this.promptIndex < 0 || this.promptIndex >= state.shuffledPrompts.length)
      throw new Error("Invalid vote index");
    if (state.votingDeadline && this.at > state.votingDeadline) throw new Error("Voting deadline passed");

    const votes = await gateway.appendVote(this.roundId, this.playerId, this.promptIndex);

    const allVoted = votes >= state.players.length;
    const timedOut = !!state.votingDeadline && this.at >= state.votingDeadline;

    if (allVoted || timedOut) {
      // Compute scores and finish
      // TODO: use RoundRules.calculateScores(state)
      const scores = {} as Record<PlayerId, number>;
      for (const pid of state.players) scores[pid] = 0; // placeholder

      state.scores = scores;
      state.phase = "scoring";
      await gateway.saveRoundState(state);
      await bus.publish(`round:${state.id}`, { type: "PhaseChanged", phase: state.phase, at: this.at });

      // Optionally finalize
      state.phase = "finished";
      state.finishedAt = this.at;
      await gateway.saveRoundState(state);
      await bus.publish(`round:${state.id}`, { type: "RoundFinished", at: this.at, scores: state.scores });
    }
  }
}
```

### 6.4 PhaseTimeout (system-triggered)

```ts
export class PhaseTimeout extends Command {
  readonly type = "PhaseTimeout" as const;
  constructor(
    public readonly roundId: RoundId,
    public readonly phase: Exclude<RoundPhase, "scoring" | "finished">,
    public readonly at: TimePoint
  ) { super(); }

  async execute({ gateway, bus }: CommandContext): Promise<void> {
    const state = await gateway.loadRoundState(this.roundId);
    if (state.phase !== this.phase) return; // idempotent no-op if already advanced

    // Advance phase based on which deadline expired
    if (this.phase === "prompt" && state.promptDeadline && this.at >= state.promptDeadline) {
      state.phase = "guessing";
    } else if (this.phase === "guessing" && state.guessingDeadline && this.at >= state.guessingDeadline) {
      // shuffle available prompts (may be incomplete)
      state.shuffledPrompts = Object.values(state.prompts ?? {}).sort(() => Math.random() - 0.5);
      state.phase = "voting";
    } else if (this.phase === "voting" && state.votingDeadline && this.at >= state.votingDeadline) {
      state.phase = "scoring";
    } else {
      return; // deadline not actually expired
    }

    await gateway.saveRoundState(state);
    await bus.publish(`round:${state.id}`, { type: "PhaseChanged", phase: state.phase, at: this.at });
  }
}
```

> **Note:** Examples above intentionally keep scoring/shuffling placeholders. Implement real logic in `RoundRules.ts` and import here.

---

## 7) Storage Adapter Guidance

- **Atomicity:** `appendPrompt` and `appendVote` must be atomic and **idempotent** (same player submitting twice should not change counts).
- **Return values:** These methods must return **post-update counts** to avoid update-then-read round trips.
- **`saveRoundState`:** Implement optimistic concurrency or diff-merge internally; the domain should not carry versions.
- **Static mutability:** Treat fields like `prompts`, `votes`, `phase`, `shuffledPrompts`, `scores`, `finishedAt` as mutable; others are immutable after creation.
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

## 9) How to Implement a New Command (Checklist)

1. **Decide intent and phase.** Which phase accepts this action? What invariants apply?
2. **Create command class** in `/domain/commands`, extending `Command` and adding required fields.
3. **Validate** inside `execute`: phase, actor permissions, deadlines, indices.
4. **Use gateway** methods for persistence. Avoid read-after-write by relying on returned counts.
5. **Advance phase** if needed, then `saveRoundState` once per transition.
6. **Publish events** via `MessageBus` to notify clients.
7. **Write tests**: unit tests for `RoundRules` logic; integration with `memory` gateway adapter.

---

## 10) Testing Strategy

- **Unit tests (pure):** `RoundRules` (shuffling, scoring, validations) with fixed seeds and snapshots.
- **Command tests:** Use `memory` gateway + `noop` bus to verify:
  - valid/invalid transitions
  - deadlines enforcement
  - idempotency (double submit doesn’t double count)
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

