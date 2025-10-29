import { describe, expect, it } from "vitest";

import { StartNextRound } from "../src/domain/commands/StartNextRound.js";
import { createCommandContext } from "./support/mocks.js";
import { StartNextRoundInputError } from "../src/domain/errors/StartNextRoundInputError.js";
import { createGameConfig } from "../src/domain/GameConfig.js";

const GAME_ID = "game-1";
const PLAYERS = ["alex", "bailey", "casey", "devon"] as const satisfies readonly string[];

const baseGameState = () => ({
  id: GAME_ID,
  players: [...PLAYERS],
  host: PLAYERS[0],
  activeRoundId: undefined,
  currentRoundIndex: 0,
  cumulativeScores: Object.fromEntries(PLAYERS.map((player) => [player, 0])),
  config: createGameConfig({ totalRounds: 3 }),
  phase: "lobby" as const,
});

const baseRoundState = (roundId: string, activePlayer: string) => ({
  id: roundId,
  gameId: GAME_ID,
  players: [...PLAYERS],
  activePlayer,
  phase: "prompt" as const,
  startedAt: Date.now(),
  prompts: {},
  seed: 42,
});

describe("StartNextRound command", () => {
  it("starts a new round and publishes the round started event", async () => {
    const context = createCommandContext();
    const { gameGateway, roundGateway, scheduler, bus } = context;
    const now = Date.now();
    const gameState = baseGameState();
    gameGateway.loadGameState.mockResolvedValue(gameState);
    roundGateway.startNewRound.mockResolvedValue(baseRoundState("round-1", PLAYERS[0]));

    const command = new StartNextRound(GAME_ID, now);
    await command.execute(context);

    expect(roundGateway.startNewRound).toHaveBeenCalledWith(
      GAME_ID,
      [...PLAYERS],
      PLAYERS[0],
      now,
    );
    expect(gameGateway.saveGameState).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRoundId: "round-1",
        phase: "active",
      }),
    );
    expect(scheduler.scheduleTimeout).toHaveBeenCalledWith(
      "round-1",
      "prompt",
      gameState.config.promptDurationMs,
    );
    expect(bus.publish).toHaveBeenCalledWith(`round:round-1`, {
      type: "RoundStarted",
      gameId: GAME_ID,
      roundId: "round-1",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      at: now,
      promptDurationMs: gameState.config.promptDurationMs,
    });
  });

  it("rotates the active player based on the current round index", async () => {
    const context = createCommandContext();
    const { gameGateway, roundGateway } = context;
    const gameState = { ...baseGameState(), currentRoundIndex: 1 };
    gameGateway.loadGameState.mockResolvedValue(gameState);
    roundGateway.startNewRound.mockResolvedValue(baseRoundState("round-2", PLAYERS[1]));

    await new StartNextRound(GAME_ID, Date.now()).execute(context);

    expect(roundGateway.startNewRound).toHaveBeenCalledWith(
      GAME_ID,
      [...PLAYERS],
      PLAYERS[1],
      expect.any(Number),
    );
  });

  it("throws when the game already has an active round", async () => {
    const context = createCommandContext();
    const { gameGateway } = context;
    const gameState = { ...baseGameState(), activeRoundId: "round-99", phase: "active" as const };
    gameGateway.loadGameState.mockResolvedValue(gameState);

    const command = new StartNextRound(GAME_ID, Date.now());
    await expect(command.execute(context)).rejects.toThrow(StartNextRoundInputError);
    expect(context.roundGateway.startNewRound).not.toHaveBeenCalled();
  });

  it("throws when the game does not have enough players", async () => {
    const context = createCommandContext();
    const { gameGateway } = context;
    const gameState = {
      ...baseGameState(),
      players: [PLAYERS[0], PLAYERS[1]],
      cumulativeScores: { [PLAYERS[0]]: 0, [PLAYERS[1]]: 0 },
    };
    gameGateway.loadGameState.mockResolvedValue(gameState);

    const command = new StartNextRound(GAME_ID, Date.now());
    await expect(command.execute(context)).rejects.toThrow(StartNextRoundInputError);
    expect(context.roundGateway.startNewRound).not.toHaveBeenCalled();
  });
});
