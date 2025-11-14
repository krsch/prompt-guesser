import { describe, expect, it } from "vitest";

import { createCommandContext } from "./support/mocks.js";
import { SubmitPrompt } from "../src/domain/commands/SubmitPrompt.js";
import { createGameConfig } from "../src/domain/GameConfig.js";
import type { RoundState, ValidRoundState } from "../src/domain/ports/RoundGateway.js";

describe("SubmitPrompt command", () => {
  it("stores the prompt, generates the image, advances the phase to guessing and publishes events", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, imageGenerator, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      gameId: "game-1",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      seed: 42,
      prompts: {},
    };

    gameGateway.loadGameState.mockResolvedValue({
      id: round.gameId,
      players: [...round.players],
      host: round.activePlayer,
      activeRoundId: round.id,
      currentRoundIndex: 0,
      cumulativeScores: {},
      config,
      phase: "active",
    });

    roundGateway.loadRoundState.mockResolvedValue(round);
    roundGateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: { [round.activePlayer]: "real prompt" },
    });
    imageGenerator.generate.mockResolvedValue("https://example.com/image.png");

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);
    await command.execute(context);

    expect(roundGateway.loadRoundState).toHaveBeenCalledWith(round.id);
    expect(roundGateway.appendPrompt).toHaveBeenCalledWith(
      round.id,
      round.activePlayer,
      "real prompt",
    );
    expect(imageGenerator.generate).toHaveBeenCalledWith("real prompt");
    expect(roundGateway.saveRoundState).toHaveBeenCalledTimes(1);
    expect(roundGateway.saveRoundState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: round.id,
        phase: "guessing",
        imageUrl: "https://example.com/image.png",
        prompts: {
          [round.activePlayer]: "real prompt",
        },
      }),
    );
    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "ImageGenerated",
      roundId: round.id,
      imageUrl: "https://example.com/image.png",
      guessingDurationMs: config.guessingDurationMs,
    });
    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "PhaseChanged",
      phase: "guessing",
      at: now,
    });
    expect(scheduler.scheduleTimeout).toHaveBeenCalledWith(
      round.id,
      "guessing",
      config.guessingDurationMs,
    );
  });

  it("throws when the round is not in the prompt phase", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      gameId: "game-1",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "guessing",
      startedAt: now - 1000,
      seed: 42,
      prompts: { p1: "real prompt" },
      imageUrl: "https://example.com/image.png",
    };

    roundGateway.loadRoundState.mockResolvedValue(round);
    gameGateway.loadGameState.mockResolvedValue({
      id: round.gameId,
      players: [...round.players],
      host: round.activePlayer,
      activeRoundId: round.id,
      currentRoundIndex: 0,
      cumulativeScores: {},
      config: createGameConfig(),
      phase: "active",
    });

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);

    await expect(command.execute(context)).rejects.toThrow(/prompt phase/);
  });

  it("throws when the submitting player is not the active player", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      gameId: "game-1",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      seed: 42,
      prompts: {},
    };

    roundGateway.loadRoundState.mockResolvedValue(round);
    gameGateway.loadGameState.mockResolvedValue({
      id: round.gameId,
      players: [...round.players],
      host: round.activePlayer,
      activeRoundId: round.id,
      currentRoundIndex: 0,
      cumulativeScores: {},
      config: createGameConfig(),
      phase: "active",
    });

    const command = new SubmitPrompt(round.id, "p2", "real prompt", now);

    await expect(command.execute(context)).rejects.toThrow(/active player/);
  });

  it("throws if the prompt was not persisted", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, imageGenerator } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      gameId: "game-1",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      seed: 42,
      prompts: {},
    };

    roundGateway.loadRoundState.mockResolvedValue(round);
    roundGateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: {} as Record<string, string>,
    });
    gameGateway.loadGameState.mockResolvedValue({
      id: round.gameId,
      players: [...round.players],
      host: round.activePlayer,
      activeRoundId: round.id,
      currentRoundIndex: 0,
      cumulativeScores: {},
      config: createGameConfig(),
      phase: "active",
    });

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);

    await expect(command.execute(context)).rejects.toThrow(/persist/);
    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(roundGateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("is idempotent when the prompt has already been stored", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, imageGenerator } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      gameId: "game-1",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      seed: 42,
      prompts: {},
    };

    roundGateway.loadRoundState.mockResolvedValue(round);
    roundGateway.appendPrompt.mockResolvedValue({
      inserted: false,
      prompts: { [round.activePlayer]: "real prompt" },
    });
    gameGateway.loadGameState.mockResolvedValue({
      id: round.gameId,
      players: [...round.players],
      host: round.activePlayer,
      activeRoundId: round.id,
      currentRoundIndex: 0,
      cumulativeScores: {},
      config: createGameConfig(),
      phase: "active",
    });

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);
    await command.execute(context);

    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(roundGateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });
});
