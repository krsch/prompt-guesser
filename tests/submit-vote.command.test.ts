import { describe, expect, it } from "vitest";

import { createCommandContext } from "./support/mocks.js";
import { SubmitVote } from "../src/domain/commands/SubmitVote.js";
import { createGameConfig } from "../src/domain/GameConfig.js";
import type { RoundState, ValidRoundState } from "../src/domain/ports/RoundGateway.js";
import type { PlayerId } from "../src/domain/typedefs.js";

const PLAYERS = [
  "active",
  "blue",
  "green",
  "orange",
] as const satisfies readonly string[];

type RoundOverrides = Partial<Omit<RoundState, "prompts" | "votes">> & {
  readonly prompts?: Record<string, string>;
  readonly votes?: Record<string, number>;
};

const baseRound = (overrides: RoundOverrides = {}): RoundState => ({
  id: "round-123",
  gameId: "game-1",
  players: [...PLAYERS],
  activePlayer: PLAYERS[0],
  phase: "voting",
  startedAt: Date.now() - 10_000,
  prompts: {
    [PLAYERS[0]]: "real prompt",
    [PLAYERS[1]]: "blue decoy",
    [PLAYERS[2]]: "green decoy",
    [PLAYERS[3]]: "orange decoy",
  },
  shuffleOrder: [0, 1, 2, 3],
  votes: {} as Record<string, number>,
  seed: 1234,
  imageUrl: "https://example.com/image.png",
  ...overrides,
});

describe("SubmitVote command", () => {
  it("records a vote and finalizes the round once all votes are in", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, config } = context;
    const now = Date.now();
    const round = baseRound({
      votes: {
        [PLAYERS[1]]: 1,
        [PLAYERS[2]]: 2,
      },
    });

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);
    roundGateway.appendVote.mockResolvedValue({
      inserted: true,
      votes: {
        [PLAYERS[1]]: 1,
        [PLAYERS[2]]: 2,
        [PLAYERS[3]]: 0,
      } as Record<string, number>,
    });
    gameGateway.loadGameState.mockResolvedValue({
      id: round.gameId,
      players: [...round.players],
      host: round.activePlayer,
      activeRoundId: round.id,
      currentRoundIndex: 0,
      cumulativeScores: {},
      config: { ...config, totalRounds: 1 },
      phase: "active",
    });

    const command = new SubmitVote(round.id, PLAYERS[3], 0, now);
    await command.execute(context);

    expect(roundGateway.appendVote).toHaveBeenCalledWith(round.id, PLAYERS[3], 0);
    expect(roundGateway.saveRoundState).toHaveBeenCalledTimes(2);

    expect(bus.publish).toHaveBeenNthCalledWith(1, `round:${round.id}`, {
      type: "PhaseChanged",
      phase: "scoring",
      at: now,
    });
    expect(bus.publish).toHaveBeenNthCalledWith(2, `round:${round.id}`, {
      type: "PhaseChanged",
      phase: "finished",
      at: now,
    });
    expect(bus.publish).toHaveBeenNthCalledWith(3, `round:${round.id}`, {
      type: "RoundFinished",
      roundId: round.id,
      at: now,
      scores: {
        [PLAYERS[0]]: 3,
        [PLAYERS[1]]: 1,
        [PLAYERS[2]]: 1,
        [PLAYERS[3]]: 3,
      },
    });
  });

  it("does not finalize when votes are still missing", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, config } = context;
    const now = Date.now();
    const round = baseRound();

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);
    roundGateway.appendVote.mockResolvedValue({
      inserted: true,
      votes: {
        [PLAYERS[1]]: 1,
      } as Record<string, number>,
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

    const command = new SubmitVote(round.id, PLAYERS[1], 1, now);
    await command.execute(context);

    expect(roundGateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("is idempotent when the player repeats the same vote", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, config } = context;
    const now = Date.now();
    const round = baseRound({
      votes: { [PLAYERS[1]]: 2 },
    });

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);

    roundGateway.appendVote.mockResolvedValue({
      inserted: false,
      votes: { [PLAYERS[1]]: 2 } as Record<string, number>,
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

    const command = new SubmitVote(round.id, PLAYERS[1], 2, now);
    await command.execute(context);

    expect(roundGateway.appendVote).toHaveBeenCalledWith(round.id, PLAYERS[1], 2);
    expect(roundGateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("throws when executed outside of the voting phase", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway } = context;
    const round = baseRound({ phase: "guessing" });

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);
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

    const command = new SubmitVote(round.id, PLAYERS[1], 0, Date.now());

    await expect(command.execute(context)).rejects.toThrow(/voting phase/);
  });

  it("throws when the vote index is out of bounds", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway } = context;
    const round = baseRound();

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);
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

    const command = new SubmitVote(round.id, PLAYERS[1], 99, Date.now());

    await expect(command.execute(context)).rejects.toThrow(/Invalid vote index/);
  });

  it("rejects votes from the active player", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway } = context;
    const round = baseRound();

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);
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

    const command = new SubmitVote(round.id, PLAYERS[0], 0, Date.now());

    await expect(command.execute(context)).rejects.toThrow(/Active player cannot vote/);
  });

  it("rejects votes from players outside the round", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway } = context;
    const round = baseRound();

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);
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

    const command = new SubmitVote(round.id, "stranger" as PlayerId, 0, Date.now());

    await expect(command.execute(context)).rejects.toThrow(/part of this round/);
  });
});
