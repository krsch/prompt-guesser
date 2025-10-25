import { describe, it, expect, vi } from "vitest";

import { SubmitVote } from "../src/domain/commands/SubmitVote";
import type { RoundGateway, RoundState } from "../src/domain/ports/RoundGateway";
import type { MessageBus } from "../src/domain/ports/MessageBus";
import { GameConfig } from "../src/domain/GameConfig";
import type { PlayerId } from "../src/domain/typedefs";

const makeGateway = () =>
  ({
    loadRoundState: vi.fn(),
    appendVote: vi.fn(),
    saveRoundState: vi.fn(),
  }) satisfies Partial<RoundGateway>;

const makeBus = () =>
  ({
    publish: vi.fn(),
  }) satisfies Partial<MessageBus>;

const makeConfig = () => GameConfig.withDefaults();

const PLAYERS = ["active", "blue", "green", "orange"] as const;

const baseRound = (overrides: Partial<RoundState> = {}): RoundState => ({
  id: "round-123",
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
  votes: {},
  seed: 1234,
  ...overrides,
});

describe("SubmitVote command", () => {
  it("records a vote and finalizes the round once all votes are in", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const now = Date.now();
    const round = baseRound({ votes: { [PLAYERS[1]]: 1, [PLAYERS[2]]: 2 } });

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendVote.mockResolvedValue({
      inserted: true,
      votes: {
        [PLAYERS[1]]: 1,
        [PLAYERS[2]]: 2,
        [PLAYERS[3]]: 0,
      },
    });

    const command = new SubmitVote(round.id, PLAYERS[3], 0, now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: { generate: vi.fn() } as any,
      config,
    });

    expect(gateway.appendVote).toHaveBeenCalledWith(round.id, PLAYERS[3], 0);
    expect(gateway.saveRoundState).toHaveBeenCalledTimes(2);

    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "PhaseChanged",
      phase: "scoring",
      at: now,
    });
    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
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
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const now = Date.now();
    const round = baseRound();

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendVote.mockResolvedValue({
      inserted: true,
      votes: {
        [PLAYERS[1]]: 1,
      },
    });

    const command = new SubmitVote(round.id, PLAYERS[1], 1, now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: { generate: vi.fn() } as any,
      config,
    });

    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("is idempotent when the player repeats the same vote", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const now = Date.now();
    const round = baseRound({ votes: { [PLAYERS[1]]: 2 } });

    gateway.loadRoundState.mockResolvedValue(round);

    gateway.appendVote.mockResolvedValue({
      inserted: false,
      votes: { [PLAYERS[1]]: 2 },
    });

    const command = new SubmitVote(round.id, PLAYERS[1], 2, now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: { generate: vi.fn() } as any,
      config,
    });

    expect(gateway.appendVote).toHaveBeenCalledWith(round.id, PLAYERS[1], 2);
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("throws when executed outside of the voting phase", async () => {
    const gateway = makeGateway();
    const config = makeConfig();
    const round = baseRound({ phase: "guessing" });

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitVote(round.id, PLAYERS[1], 0, Date.now());

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: makeBus() as MessageBus,
        imageGenerator: { generate: vi.fn() } as any,
        config,
      }),
    ).rejects.toThrow(/voting phase/);
  });

  it("throws when the vote index is out of bounds", async () => {
    const gateway = makeGateway();
    const config = makeConfig();
    const round = baseRound();

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitVote(round.id, PLAYERS[1], 99, Date.now());

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: makeBus() as MessageBus,
        imageGenerator: { generate: vi.fn() } as any,
        config,
      }),
    ).rejects.toThrow(/Invalid vote index/);
  });

  it("rejects votes from the active player", async () => {
    const gateway = makeGateway();
    const config = makeConfig();
    const round = baseRound();

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitVote(round.id, PLAYERS[0], 0, Date.now());

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: makeBus() as MessageBus,
        imageGenerator: { generate: vi.fn() } as any,
        config,
      }),
    ).rejects.toThrow(/Active player cannot vote/);
  });

  it("rejects votes from players outside the round", async () => {
    const gateway = makeGateway();
    const config = makeConfig();
    const round = baseRound();

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitVote(round.id, "stranger" as PlayerId, 0, Date.now());

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: makeBus() as MessageBus,
        imageGenerator: { generate: vi.fn() } as any,
        config,
      }),
    ).rejects.toThrow(/part of this round/);
  });
});
