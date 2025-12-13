import { describe, expect, it, vi } from "vitest";

import { StateFailureError } from "@prompt-guesser/core/mvcc/errors.js";
import { ConflictError } from "@prompt-guesser/core/mvcc/errors.js";

import { createBackendApp } from "../src/app.js";
import type { GameId, GameService } from "../src/core.js";
import { createTestContext } from "./support/testContext.js";

describe("backend-local HTTP routes", () => {
  it("reports health status", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 4321,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, config: { port: 4321 } });
    expect(typeof body["timestamp"]).toBe("number");
  });

  it("starts a round via POST /api/round/start", async () => {
    vi.useFakeTimers();
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);

    const testContext = createTestContext();

    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request(`/api/games/${testContext.gameId}/rounds/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: ["alice", "bob", "carol"], activePlayer: "alice" }),
    });

    expect(response.status).toBe(201);
    const visible = (await response.json()) as {
      currentRound?: { id: string; state: { players: string[] } };
    };
    const location = response.headers.get("Location");
    expect(visible.currentRound?.state.players).toEqual([
      "host",
      "alice",
      "bob",
      "carol",
    ]);
    expect(testContext.scheduler.scheduled[0]).toMatchObject({
      roundId: visible.currentRound?.id,
      phase: "prompt",
      delayMs: testContext.config.promptDurationMs,
    });
    expect(location).toBe(
      `/api/games/${testContext.gameId}/rounds/${visible.currentRound?.id}`,
    );
  });

  it("returns 400 for invalid start payloads", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request(`/api/games/${testContext.gameId}/rounds/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: [] }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for invalid params schema", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request(`/api/games//rounds/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: ["alice", "bob", "carol"], activePlayer: "alice" }),
    });

    expect(response.status).toBe(404);
  });

  it("fails to start a round for a missing game", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request(`/api/games/missing-game/rounds/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: ["alice", "bob", "carol"], activePlayer: "alice" }),
    });

    expect(response.status).toBe(404);
  });

  it("loads a round snapshot", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      defaultConfig: testContext.config,
      bus: testContext.bus,
      logger: testContext.logger,
      gameStore: testContext.gameStore,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const startResponse = await app.request(
      `/api/games/${testContext.gameId}/rounds/start`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          players: ["carol", "dave", "erin"],
          activePlayer: "carol",
        }),
      },
    );
    const current = (await startResponse.json()) as { currentRound?: { id: string } };

    const roundId = current.currentRound?.id;
    const response = await app.request(
      `/api/games/${testContext.gameId}/rounds/${roundId}`,
    );

    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as { players: string[]; phase: string };
    expect(snapshot.players).toEqual(["host", "carol", "dave", "erin"]);
    expect(snapshot.phase).toBe("prompt");
  });

  it("returns 404 when round is missing", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      defaultConfig: testContext.config,
      bus: testContext.bus,
      logger: testContext.logger,
      gameStore: testContext.gameStore,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request(
      `/api/games/${testContext.gameId}/rounds/does-not-exist`,
    );

    expect(response.status).toBe(404);
  });

  it("handles OPTIONS preflight", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      defaultConfig: testContext.config,
      bus: testContext.bus,
      logger: testContext.logger,
      gameStore: testContext.gameStore,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request("/api/games", { method: "OPTIONS" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 413 when payload too large", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const bigBody = JSON.stringify({ host: "x".repeat(70 * 1024) });
    const response = await app.request("/api/games", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(bigBody.length),
      },
      body: bigBody,
    });

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("payload_too_large");
  });

  it("maps domain internal failure to 500", async () => {
    const testContext = createTestContext();
    const failingService = {
      run: vi.fn(async () => {
        throw new StateFailureError("boom");
      }),
    } as unknown as GameService;

    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: failingService,
      scheduler: testContext.scheduler,
    });

    const response = await app.request(
      `/api/games/${testContext.gameId}/rounds/${testContext.gameId}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: "p1", prompt: "hi" }),
      },
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("internal_error");
  });

  it("maps conflict domain error to 409", async () => {
    const testContext = createTestContext();
    const conflictService = {
      run: vi.fn(async () => {
        throw new ConflictError("conflict");
      }),
    } as unknown as GameService;

    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: conflictService,
      scheduler: testContext.scheduler,
    });

    const response = await app.request(
      `/api/games/${testContext.gameId}/rounds/${testContext.gameId}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: "p1", prompt: "hi" }),
      },
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("conflict");
  });

  it("creates a lobby and returns visible state", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request("/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "new-host" }),
    });

    expect(response.status).toBe(201);
    const location = response.headers.get("Location");
    const visible = (await response.json()) as {
      id: string;
      lobby: { players: string[] };
    };
    expect(visible.lobby.players).toEqual(["new-host"]);
    expect(location).toBe(`/api/games/${visible.id}`);
    const stored = await testContext.gameStore.loadGame(visible.id as GameId);
    expect(stored.lobby.players).toEqual(["new-host"]);
  });

  it("joins and leaves lobby via dedicated endpoints", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const joinRes = await app.request(`/api/games/${testContext.gameId}/lobby/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "alice" }),
    });
    expect(joinRes.status).toBe(200);
    const afterJoin = (await joinRes.json()) as { lobby: { players: string[] } };
    expect(afterJoin.lobby.players).toEqual(["host", "alice"]);

    const leaveRes = await app.request(`/api/games/${testContext.gameId}/lobby/leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "alice" }),
    });
    expect(leaveRes.status).toBe(200);
    const afterLeave = (await leaveRes.json()) as { lobby: { players: string[] } };
    expect(afterLeave.lobby.players).toEqual(["host"]);
  });

  it("kicks a player from lobby", async () => {
    const testContext = createTestContext();
    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    await app.request(`/api/games/${testContext.gameId}/lobby/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "alice" }),
    });

    const kickRes = await app.request(`/api/games/${testContext.gameId}/lobby/kick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "alice" }),
    });

    expect(kickRes.status).toBe(200);
    const visible = (await kickRes.json()) as { lobby: { players: string[] } };
    expect(visible.lobby.players).toEqual(["host"]);
  });
});
