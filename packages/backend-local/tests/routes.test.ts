import { describe, expect, it, vi } from "vitest";

import { createBackendApp } from "../src/app.js";
import type { GameId } from "../src/core.js";
import { createTestContext } from "./support/testContext.js";

describe("backend-local HTTP routes", () => {
  it("reports health status", async () => {
    const testContext = createTestContext();
    let activeGameId: GameId = testContext.gameId;
    const app = createBackendApp({
      port: 4321,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      getActiveGameId: () => activeGameId,
      setActiveGameId: (next) => {
        activeGameId = next;
      },
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
    let activeGameId: GameId = testContext.gameId;

    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      getActiveGameId: () => activeGameId,
      setActiveGameId: (next) => {
        activeGameId = next;
      },
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request("/api/round/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: ["alice", "bob", "carol"], activePlayer: "alice" }),
    });

    expect(response.status).toBe(200);
    const visible = (await response.json()) as {
      currentRound?: { id: string; state: { players: string[] } };
    };
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
  });

  it("returns 400 for invalid start payloads", async () => {
    const testContext = createTestContext();
    let activeGameId: GameId = testContext.gameId;
    const app = createBackendApp({
      port: 9999,
      gameStore: testContext.gameStore,
      bus: testContext.bus,
      logger: testContext.logger,
      defaultConfig: testContext.config,
      getActiveGameId: () => activeGameId,
      setActiveGameId: (next) => {
        activeGameId = next;
      },
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const response = await app.request("/api/round/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: [] }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");
  });

  it("loads a round snapshot", async () => {
    const testContext = createTestContext();
    let activeGameId: GameId = testContext.gameId;
    const app = createBackendApp({
      port: 9999,
      defaultConfig: testContext.config,
      getActiveGameId: () => activeGameId,
      setActiveGameId: (next) => {
        activeGameId = next;
      },
      bus: testContext.bus,
      logger: testContext.logger,
      gameStore: testContext.gameStore,
      service: testContext.service,
      scheduler: testContext.scheduler,
    });

    const startResponse = await app.request("/api/round/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: ["carol", "dave", "erin"], activePlayer: "carol" }),
    });
    const current = (await startResponse.json()) as { currentRound?: { id: string } };

    const roundId = current.currentRound?.id;
    const response = await app.request(`/api/round/${roundId}`);

    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as { players: string[]; phase: string };
    expect(snapshot.players).toEqual(["host", "carol", "dave", "erin"]);
    expect(snapshot.phase).toBe("prompt");
  });
});
