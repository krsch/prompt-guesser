# Backend Local — Test Plan

**Package:** `@prompt-guesser/backend-local`  
**Role:** Local runtime for Prompt Guesser, primarily for manual testing & dev, with light automated coverage to ensure MVCC wiring doesn’t silently break.

---

## 1. Testing Philosophy

- **Do not re-test MVCC command logic.** That is covered by the core package tests.
- **Focus on runtime wiring:**
  - HTTP routes → `GameService` + MVCC commands
  - Adapters → ports (`Scheduler`, `MessageBus`, `ImageGenerator`)
  - Event flow → HTTP/WS integration and visible-state projection
- **Keep tests fast and deterministic.**
  Mock `fetch`, `setTimeout`, and sockets; avoid real network where possible.

We aim for a **thin but meaningful** layer of tests that catch integration mistakes without duplicating domain logic tests.

---

## 2. Test Stack

Preferred tooling (can be adjusted if repo already uses something else):

- **Test runner:** Vitest or Jest
- **HTTP layer:** Hono’s `app.request()` (no real port needed)
- **Mocking:** built-in mocks/spies (`vi.fn()` / `jest.fn()`)
- **WS tests:** fake sockets for most tests; 1–2 real WS tests if desired

---

## 3. What to Test (and Not to Test)

### 3.1 In Scope

1. **Adapters**
   - `OpenAIImageGenerator` (REST via `fetch`, env-driven)
   - `RealScheduler` (timeouts → `PhaseTimeout`)
   - `WebSocketBus` (event publishing to subscribers)

2. **HTTP API**
   - `/api/health`
   - `POST /api/games` (creates lobby; 201 + Location)
   - `GET /api/games/:gameId` (visible state)
   - `POST /api/games/:gameId/lobby/{join|leave|kick}`
   - `POST /api/games/:gameId/rounds/start` (201 + Location)
   - `GET /api/games/:gameId/rounds/:id` (visible round)
   - `POST /api/games/:gameId/rounds/:id/{prompt|decoy|vote}`
   - basic error paths (bad input, not found)

3. **WS Integration**
   - WebSocket clients subscribe to `game:<id>` and receive visible-state updates.
   - Publishing via `MessageBus` delivers JSON events to those clients.

### 3.2 Out of Scope

- Domain rules, scoring, and invariants (already tested in `@prompt-guesser/domain`).
- Complex concurrency scenarios (covered by domain + storage adapter tests).
- End-to-end browser UI (handled by frontend or manual testing).

---

## 4. Test Categories

### 4.1 Adapter Tests

#### 4.1.1 `OpenAIImageGenerator`

**Goal:** Verify REST call shape, error handling, and caching.

**Approach:**

- **Mock `global.fetch`.**

- ✅ **Happy path**
  - Arrange: `fetch` resolves to `{ ok: true, json: () => ({ data: [{ url }] }) }`.
  - Act: `generate("prompt")`.
  - Assert:
    - `fetch` called once with:
      - URL: `https://api.openai.com/v1/images/generations`
      - method: `POST`
      - headers: `Authorization: Bearer ...`, `Content-Type: application/json`
      - body includes `{ model: "gpt-image-1", prompt, size: "512x512" }`

    - Return value equals `url`.

- ✅ **Caching**
  - Call `generate("same prompt")` twice.
  - Assert `fetch` called only once.

- ✅ **Error handling**
  - Non-OK response: `ok: false`, body `"something broke"`.
  - Assert: `generate` rejects with meaningful error message.

Edge cases (optional):

- Missing `data[0].url` → throws a descriptive error.

---

#### 4.1.2 `RealScheduler`

**Goal:** Ensure that scheduling a timeout eventually dispatches `PhaseTimeout` with correct parameters.

**Approach:**

- **Mock `setTimeout`** (or spy on it).
- ✅ **Scheduling behaviour**
  - Arrange: `dispatch = vi.fn()`.
  - Create `scheduler = new RealScheduler(dispatch)`.
  - Act: `scheduler.scheduleTimeout("round-1", "prompt", 5000)`.
  - Assert:
    - `setTimeout` called once with a callback and delay `5000`.
    - Invoke the captured callback manually.
    - `dispatch` called with a `PhaseTimeout` instance whose:
      - `roundId` is `"round-1"`
      - `phase` is `"prompt"`

Optional:

- Verify errors in the callback are caught and logged (not re-thrown).

---

#### 4.1.3 `WebSocketBus`

**Goal:** Ensure bus keeps track of subscribers and publishes correctly.

**Approach:**

- Use a **FakeSocket** type:

  ```ts
  type FakeSocket = {
    send: (data: string) => void;
    close: () => void;
    readyState: number;
  };
  ```

- ✅ **Subscription**
  - Subscribe fake socket to channel `"round:abc"`.
  - Assert it’s stored internally (if accessible via test hooks) or at least that publishing later calls `send`.

- ✅ **Publish**
  - Arrange: one or more fake sockets subscribed to `"round:abc"`, with `send` as a spy.
  - Act: `bus.publish("round:abc", { type: "PhaseChanged", phase: "guessing" })`.
  - Assert:
    - Each subscriber’s `send` called once.
    - Payload is valid JSON and parses to `{ type: "PhaseChanged", phase: "guessing" }` or includes channel if you wrap it: `{ channel, event }`.

- ✅ **Unsubscribe / closed sockets** (if implemented)
  - Mark one socket as closed (`readyState` not open).
  - Publish again.
  - Assert closed sockets are removed / not called.

---

### 4.2 HTTP Route Tests

Use a **`createApp(ctx)`** function so we can test without binding to a port.

#### 4.2.1 `/api/health`

**Goal:** Smoke test server is wired and route works.

- Act: `app.request("/api/health")`.
- Assert:
  - `status` is `200`.
  - JSON contains `{ ok: true }` and a numeric `ts`.

#### 4.2.2 `/api/games/:gameId/rounds/start`

**Goal:** Ensure starting a round hits the MVCC service & scheduler and returns a sensible payload.

Use **fake adapters** (no real OpenAI, no setTimeout):

- `FakeScheduler`: records scheduled timeouts.
- `FakeImageGenerator`: returns fixed URL.
- `FakeBus`: records published events.

**Test cases:**

- ✅ **Happy path**
  - Act: `POST /api/games/:id/rounds/start` with `{ players: [...], activePlayer }`.
  - Assert:
    - `status` is `201` with `Location` header.
    - Body includes `currentRound` with players merged with host and `phase: "prompt"`.
    - `FakeScheduler.scheduleTimeout` called with `phase: "prompt"` and configured delay.
    - `FakeBus` receives a visible-state update.

- ✅ **Bad input / missing game** (optional)
  - Missing/empty players → 400
  - Nonexistent game → 404
  - Check for meaningful error and 4xx status.

#### 4.2.3 `/api/round/:id`

**Goal:** Correctly reads state from gateway.

- Arrange: pre-populate `FakeGateway` with a known round.
- Act: `GET /api/round/round-1`.
- Assert:
  - `status` 200.
  - JSON matches the stored state.

Error case:

- Unknown id → `404` or appropriate domain error mapping.

---

### 4.3 WebSocket Integration Tests

Most behaviour is covered by unit tests of `WebSocketBus`.
Optionally, have **one** integration test to ensure:

- Hono creates WS endpoint.
- A real WebSocket client receives events from a `publish` call.

**Approach (optional):**

- Start an in-memory server (or use something like `ws` server + client).
- Connect a client to `/ws/round-1`.
- Trigger an event by:
  - Calling `bus.publish("round:round-1", { type: "PhaseChanged", phase: "guessing" })`, or
  - Hitting `/api/round/start` and letting domain emit `PhaseChanged`.

- Assert the client receives the expected JSON event.

Keep this to **one or two tests** due to flakiness and speed.

---

## 5. Test Data & Fixtures

- Use simple string player IDs (`"p1"`, `"p2"`, …).
- Use deterministic round IDs in fake gateways (`"round-1"`, `"round-2"`).
- For OpenAI, never use real keys in tests; always mock `fetch`.

Recommend adding a small fixture helper:

```ts
export function createTestContext(overrides?: Partial<BackendContext>): BackendContext {
  return {
    gateway: new FakeGateway(),
    scheduler: new FakeScheduler(),
    imageGenerator: new FakeImageGenerator(),
    bus: new FakeBus(),
    config: {
      promptDurationMs: 60_000,
      guessingDurationMs: 60_000,
      votingDurationMs: 30_000,
      ...overrides?.config,
    },
    ...overrides,
  };
}
```

---

## 6. How This Interacts With Domain Tests

- When domain changes its contracts (e.g. new events, added fields), backend-local tests should catch:
  - Mis-wired context,
  - Incorrect route assumptions,
  - Broken adapter usage.

- When backend-local tests fail due to domain changes:
  - First update backend-local **wiring** and **mocks** to match new contracts,
  - Only then, if needed, extend test coverage (new routes, new events).

---

## 7. Minimum Coverage Expectations

(This isn’t about a numeric percentage, just practical guarantees.)

- ✅ At least one test for each **adapter** (`OpenAIImageGenerator`, `RealScheduler`, `WebSocketBus`).
- ✅ At least one test per **key route** (`/api/health`, `/api/round/start`, `/api/round/:id`).
- ✅ Optional but nice: one **WS integration smoke test**.

If those are green, we have high confidence that:

- The backend can start,
- Commands can be invoked,
- Timeouts and events flow correctly,
- The frontend can rely on basic API + WS behaviour.
