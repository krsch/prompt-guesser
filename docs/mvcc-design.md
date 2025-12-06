# MVCC game flow and error handling

This document summarizes the current MVCC-based game architecture so future design changes can be discussed with full context.

## Goals

- Keep game mutations deterministic and validated at the domain layer.
- Separate state changes from side effects (reactors) so side effects can be retried.
- Surface command rejections as client errors and internal failures as server errors.

## Core types

- `GameCommand`: has `type` and `apply(state): CommandResult`.
- `CommandResult`:
  - `ok`: `{ kind: "ok"; state }`
  - `rejected`: `{ kind: "rejected"; error: CommandError }` (domain invalid request)
  - `failedRound`: `{ kind: "failedRound"; state; error: StateFailureError }` (internal failure while advancing a round)
- `GameStore.updateGame(gameId, applyFn): GameStoreUpdateResult`:
  - `ok` | `failedRound` (with `change: { before, after }`)
  - `rejected` (with `CommandError`)

## Command execution path

1. `runGameCommand(gameId, cmd, store, reactors, ctx)` wraps `GameStore.updateGame`.
2. Inside `updateGame` applyFn:
   - Pre-apply validation: `assertValidGameState(state)`; failures are caught and returned as `failedRound` with the round phase marked `"failed"`.
   - Command executes: `cmd.apply(state)` returns a `CommandResult`.
   - Post-apply validation: only for `ok` results; failures are caught and converted to `failedRound` with the round phase marked `"failed"`.
   - If the command itself returns `failedRound`, we do **not** re-validate; we only mark the round `"failed"`.
3. `GameStore`:
   - Persists `ok`/`failedRound` states and returns a snapshot `change`.
   - Short-circuits on `rejected` (no state write).
4. `runGameCommand`:
   - Skips reactors on `rejected` and returns the `CommandError`.
   - Runs reactors on `ok` or `failedRound`; then returns the `StateFailureError` for `failedRound`.
5. `GameService.run` rethrows any error returned by `runGameCommand`.

## Reactors

- `GameReactor.handle(change, ctx, resultKind)` runs after state persistence.
- Current reactors:
  - `BroadcastReactor` (message bus)
  - `PhaseSchedulerReactor` (schedules phase timeouts)
  - `ImageGenerationReactor` (calls image generator and dispatches `SetRoundImage`)
- Reactors are expected to be idempotent; they can run on both `ok` and `failedRound`.

## Validation and failure semantics

- `assertValidGameState` enforces invariants (ids present, lobby players non-empty, round ids match, round validity).
- Any validation failure (before or after a command) is treated as an internal failure:
  - The current round’s phase is set to `"failed"` if present.
  - A `StateFailureError` is returned as `failedRound`, reactors run, and the error is thrown to callers.
- Commands can still emit `failedRound` directly (e.g., `SubmitVote` missing shuffle order) to encode internal consistency issues.

## Error mapping to HTTP (backend-local)

- `asDomainError` recognizes domain errors (`CommandError` → `invalid_request`, `StateFailureError` → `internal_error`, etc.).
- `respondWithMappedError` maps:
  - `invalid_request` → 400
  - `not_found` → 404
  - `conflict` → 409
  - otherwise → 500
- The response body shape: `{ error: { code, message, requestId? } }`, with logging of request metadata.

## Adapters and durability notes

- `InMemoryGameStore` is a simple MVCC store used in tests/local backend.
- Durable Object / persistent adapters can keep additional metadata (e.g., `stateCounter`, `lastReportedState`) without changing domain interfaces. Reactors can be drained idempotently using those markers.

## Testing contracts

- `tests/mvcc-foundation.test.ts` covers:
  - Reactor dispatch on `ok`
  - Rejection short-circuit
  - Reactor dispatch + error propagation on `failedRound`
  - Round phase flip to `"failed"` for both pre- and post-apply validation failures
- `tests/mvcc-service.test.ts` ensures `GameService` rethrows errors and still triggers reactors on `failedRound`.

## Considerations for future changes

- If adding non-idempotent reactors or richer failure states, ensure the store API still returns a single `change` snapshot and that `runGameCommand`’s validation behavior remains consistent.
- If round-level failure needs more metadata (reason codes), extend `StateFailureError.details` and propagate through `failedRound`.
- If adding durability markers (counters, last-reported state) to core types, thread them through `GameStoreUpdateResult` and reactor signatures intentionally; today they stay in the adapter layer.

## Idempotency and retry expectations

- `BroadcastReactor`: should publish with idempotent keys if the bus supports them; otherwise tolerate duplicate events (current implementation tolerates dupes).
- `PhaseSchedulerReactor`: reschedules timers deterministically based on state transitions; rerunning it is safe because it clears/replaces existing timeouts per `{roundId, phase}`.
- `ImageGenerationReactor`: must de-dup image requests per `{gameId, stateCounter}` (or `{roundId, prompt}`) in production. Locally it tolerates duplicates; in Cloudflare DOs/Workers AI, keep an adapter-level key store or rely on provider idempotency headers (e.g., OpenAI `Idempotency-Key: ${gameId}-${counter}-image`).
- Retry model: reactors can be rerun whenever persistence markers indicate they lag state; design them to be side-effect-only and idempotent. If you introduce non-idempotent operations (cancellations, edits), plan an outbox with explicit ids `{gameId, stateCounter, actionIndex}` and per-action retry.
