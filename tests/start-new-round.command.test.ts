import { describe, it, expect, vi } from "vitest";

import { StartNewRound } from "../src/domain/commands/StartNewRound";
import { StartNewRoundInputError } from "../src/domain/errors/StartNewRoundInputError";
import type { GameConfig } from "../src/domain/typedefs";

const makeGateway = () => ({
  startNewRound: vi.fn(),
});

const makeBus = () => ({
  publish: vi.fn(),
});

const CONFIG: GameConfig = {
  minPlayers: 4,
  maxPlayers: 6,
  promptDurationMs: 60_000,
};

describe("StartNewRound command", () => {
  it("starts a new round and publishes the round started event", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const now = Date.now();
    const players = ["p1", "p2", "p3", "p4"];
    const activePlayer = players[0];

    const roundState = {
      id: "round-1",
      players,
      activePlayer,
      phase: "prompt",
      startedAt: now,
      promptDeadline: now + CONFIG.promptDurationMs,
    };
    gateway.startNewRound.mockResolvedValue(roundState);

    const command = new StartNewRound(players, activePlayer, CONFIG, now);
    await command.execute({ gateway: gateway as any, bus: bus as any });

    expect(gateway.startNewRound).toHaveBeenCalledWith(
      players,
      activePlayer,
      now + CONFIG.promptDurationMs,
      now,
    );
    expect(bus.publish).toHaveBeenCalledWith("round:round-1", {
      type: "RoundStarted",
      roundId: "round-1",
      players,
      activePlayer,
      at: now,
    });
  });

  it("throws when player count is below the minimum", async () => {
    const now = Date.now();
    expect(() => new StartNewRound(["p1", "p2", "p3"], "p1", CONFIG, now)).toThrow(
      StartNewRoundInputError,
    );
  });

  it("throws when player count is above the maximum", async () => {
    const players = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const now = Date.now();
    expect(() => new StartNewRound(players, "p1", CONFIG, now)).toThrow(StartNewRoundInputError);
  });

  it("throws when the active player is not part of the round", async () => {
    const players = ["p1", "p2", "p3", "p4"];
    const now = Date.now();
    expect(() => new StartNewRound(players, "p5", CONFIG, now)).toThrow(StartNewRoundInputError);
  });

  it("throws when players contain duplicates", () => {
    const players = ["p1", "p1", "p2", "p3"];
    const now = Date.now();
    expect(() => new StartNewRound(players, "p1", CONFIG, now)).toThrow(StartNewRoundInputError);
  });

  it("throws when player identifiers contain whitespace", () => {
    const now = Date.now();
    expect(() => new StartNewRound(["p 1", "p2", "p3", "p4"], "p2", CONFIG, now)).toThrow(
      StartNewRoundInputError,
    );
    expect(() => new StartNewRound(["p1", "p2", "p3", "p4"], "p 2", CONFIG, now)).toThrow(
      StartNewRoundInputError,
    );
  });
});
