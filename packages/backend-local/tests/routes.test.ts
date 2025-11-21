import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackendApp } from "../src/app.js";
import type { Command, CommandContext, GameId } from "../src/core.js";
import { createCommandContextFactory, createTestContext } from "./support/testContext.js";

type DispatchCommand = (command: Command, context: CommandContext) => Promise<void>;

afterEach(() => {
  vi.useRealTimers();
});

describe("backend-local HTTP routes", () => {
  it("reports health status", async () => {
    const testContext = createTestContext();
    let activeGameId: GameId = "game-1";
    const app = createBackendApp({
      port: 4321,
      gameGateway: testContext.gameGateway,
      roundGateway: testContext.gateway,
      defaultConfig: testContext.config,
      getActiveGameId: () => activeGameId,
      setActiveGameId: (next) => {
        activeGameId = next;
      },
      bus: testContext.bus,
      logger: testContext.logger,
      createContext: createCommandContextFactory(testContext),
      dispatch: vi.fn(),
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
    const createContext = createCommandContextFactory(testContext);

    const dispatchSpy = vi.fn(async (command: Command, context: CommandContext) => {
      await command.execute(context);
    });
    const dispatch: DispatchCommand = async (command, context) =>
      dispatchSpy(command, context);

    let activeGameId: GameId = "game-1";
    const app = createBackendApp({
      port: 9999,
      gameGateway: testContext.gameGateway,
      roundGateway: testContext.gateway,
      defaultConfig: testContext.config,
      getActiveGameId: () => activeGameId,
      setActiveGameId: (next) => {
        activeGameId = next;
      },
      bus: testContext.bus,
      logger: testContext.logger,
      createContext,
      dispatch,
    });

    const response = await app.request("/api/round/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: ["alice", "bob"], activePlayer: "alice" }),
    });

    expect(response.status).toBe(200);
    const event = (await response.json()) as Record<string, unknown>;
    expect(event).toMatchObject({
      type: "RoundStarted",
      roundId: "round-1",
      players: ["alice", "bob"],
      activePlayer: "alice",
      at: now.getTime(),
      promptDurationMs: testContext.config.promptDurationMs,
    });

    expect(dispatchSpy).not.toHaveBeenCalled();

    const stored = await testContext.gateway.loadRoundState("round-1");
    expect(stored.players).toEqual(["alice", "bob"]);
  });

  it("returns 400 for invalid start payloads", async () => {
    const testContext = createTestContext();
    let activeGameId: GameId = "game-1";
    const app = createBackendApp({
      port: 9999,
      gameGateway: testContext.gameGateway,
      roundGateway: testContext.gateway,
      defaultConfig: testContext.config,
      getActiveGameId: () => activeGameId,
      setActiveGameId: (next) => {
        activeGameId = next;
      },
      bus: testContext.bus,
      logger: testContext.logger,
      createContext: createCommandContextFactory(testContext),
      dispatch: vi.fn(),
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
    const createContext = createCommandContextFactory(testContext);
    const dispatchSpy = vi.fn(async (command: Command, context: CommandContext) => {
      await command.execute(context);
    });
    const dispatch: DispatchCommand = async (command, context) =>
      dispatchSpy(command, context);

    let activeGameId: GameId = "game-1";
    const app = createBackendApp({
      port: 9999,
      gameGateway: testContext.gameGateway,
      roundGateway: testContext.gateway,
      defaultConfig: testContext.config,
      getActiveGameId: () => activeGameId,
      setActiveGameId: (next) => {
        activeGameId = next;
      },
      bus: testContext.bus,
      logger: testContext.logger,
      createContext,
      dispatch,
    });

    await app.request("/api/round/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: ["carol", "dave"], activePlayer: "carol" }),
    });

    const response = await app.request("/api/round/round-1");

    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      id: "round-1",
      players: ["carol", "dave"],
      phase: "prompt",
    });
  });
});
