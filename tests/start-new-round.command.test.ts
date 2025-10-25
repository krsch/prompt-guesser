import { describe, expect, it } from "vitest";

import { createCommandContext } from "./support/mocks.js";
import { StartNewRound } from "../src/domain/commands/StartNewRound.js";
import { StartNewRoundInputError } from "../src/domain/errors/StartNewRoundInputError.js";

describe("StartNewRound command", () => {
  it("starts a new round and publishes the round started event", async () => {
    const context = createCommandContext();
    const { gateway, bus, config, scheduler } = context;
    const now = Date.now();
    const players = ["p1", "p2", "p3", "p4"] as const satisfies readonly string[];
    const activePlayer = players[0];

    const roundState = {
      id: "round-1",
      players,
      activePlayer,
      phase: "prompt" as const,
      startedAt: now,
      seed: 1,
    };
    gateway.startNewRound.mockResolvedValue(roundState);

    const command = new StartNewRound(players, activePlayer, now);
    await command.execute(context);

    expect(gateway.startNewRound).toHaveBeenCalledWith(players, activePlayer, now);
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).toHaveBeenCalledWith("round:round-1", {
      type: "RoundStarted",
      roundId: "round-1",
      players,
      activePlayer,
      at: now,
      promptDurationMs: config.promptDurationMs,
    });
    expect(scheduler.scheduleTimeout).toHaveBeenCalledWith(
      "round-1",
      "prompt",
      config.promptDurationMs,
    );
  });

  it("throws when player count is below the minimum", async () => {
    const command = new StartNewRound(["p1", "p2", "p3"], "p1", Date.now());
    const context = createCommandContext();
    const { gateway } = context;
    await expect(command.execute(context)).rejects.toThrow(StartNewRoundInputError);
    expect(gateway.startNewRound).not.toHaveBeenCalled();
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
  });

  it("throws when player count is above the maximum", async () => {
    const players = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const command = new StartNewRound(players, "p1", Date.now());
    const context = createCommandContext();
    const { gateway } = context;
    await expect(command.execute(context)).rejects.toThrow(StartNewRoundInputError);
    expect(gateway.startNewRound).not.toHaveBeenCalled();
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
  });

  it("throws when the active player is not part of the round", async () => {
    const players = ["p1", "p2", "p3", "p4"];
    expect(() => new StartNewRound(players, "p5", Date.now())).toThrow(
      StartNewRoundInputError,
    );
  });

  it("throws when players contain duplicates", () => {
    const players = ["p1", "p1", "p2", "p3"];
    expect(() => new StartNewRound(players, "p1", Date.now())).toThrow(
      StartNewRoundInputError,
    );
  });

  it("throws when player identifiers contain whitespace", () => {
    expect(() => new StartNewRound(["p 1", "p2", "p3", "p4"], "p2", Date.now())).toThrow(
      StartNewRoundInputError,
    );
    expect(() => new StartNewRound(["p1", "p2", "p3", "p4"], "p 2", Date.now())).toThrow(
      StartNewRoundInputError,
    );
  });
});
