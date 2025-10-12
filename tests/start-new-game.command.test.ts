import { describe, it, expect, vi } from "vitest";

import { StartNewGame } from "../src/domain/commands/StartNewGame";
import { StartNewGameInputError } from "../src/domain/errors/StartNewGameInputError";

const makeGateway = () => ({
  startNewRound: vi.fn(),
});

const makeBus = () => ({
  publish: vi.fn(),
});

describe("StartNewGame command", () => {
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
    };
    gateway.startNewRound.mockResolvedValue(roundState);

    const command = new StartNewGame(players, activePlayer, now);
    await command.execute({ gateway: gateway as any, bus: bus as any });

    expect(gateway.startNewRound).toHaveBeenCalledWith(players, activePlayer);
    expect(bus.publish).toHaveBeenCalledWith("round:round-1", {
      type: "RoundStarted",
      round: roundState,
      at: now,
    });
  });

  it("throws when player count is below the minimum", async () => {
    expect(() => new StartNewGame(["p1", "p2", "p3"], "p1", Date.now())).toThrow(
      StartNewGameInputError,
    );
  });

  it("throws when player count is above the maximum", async () => {
    const players = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    expect(() => new StartNewGame(players, "p1", Date.now())).toThrow(StartNewGameInputError);
  });

  it("throws when the active player is not part of the round", async () => {
    const players = ["p1", "p2", "p3", "p4"];
    expect(() => new StartNewGame(players, "p5", Date.now())).toThrow(StartNewGameInputError);
  });

  it("throws when players contain duplicates", () => {
    const players = ["p1", "p1", "p2", "p3"];
    expect(() => new StartNewGame(players, "p1", Date.now())).toThrow(StartNewGameInputError);
  });

  it("throws when player identifiers contain whitespace", () => {
    expect(() => new StartNewGame(["p 1", "p2", "p3", "p4"], "p2", Date.now())).toThrow(
      StartNewGameInputError,
    );
    expect(() => new StartNewGame(["p1", "p2", "p3", "p4"], "p 2", Date.now())).toThrow(
      StartNewGameInputError,
    );
  });
});
