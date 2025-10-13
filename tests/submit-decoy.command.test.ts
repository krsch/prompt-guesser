import { describe, it, expect, vi } from "vitest";

import { SubmitDecoy } from "../src/domain/commands/SubmitDecoy";
import type { RoundGateway, RoundState } from "../src/domain/ports/RoundGateway";
import type { MessageBus } from "../src/domain/ports/MessageBus";
import { GameConfig } from "../src/domain/GameConfig";
import type { Scheduler } from "../src/domain/ports/Scheduler";

const makeGateway = () =>
  ({
    loadRoundState: vi.fn(),
    appendPrompt: vi.fn(),
    saveRoundState: vi.fn(),
    shufflePrompts: vi.fn((_, prompts: any[]) => prompts),
  }) satisfies Partial<RoundGateway>;

const makeBus = () =>
  ({
    publish: vi.fn(),
  }) satisfies Partial<MessageBus>;

const makeConfig = () => GameConfig.withDefaults();

const makeScheduler = () =>
  ({
    scheduleTimeout: vi.fn(),
  }) satisfies Partial<Scheduler>;

const PLAYERS = ["active", "blue", "green", "orange"] as const;

describe("SubmitDecoy command", () => {
  it("stores a decoy and transitions to voting when all prompts are submitted", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const scheduler = makeScheduler();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "guessing",
      startedAt: now - 5_000,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[2]]: "green decoy",
        [PLAYERS[3]]: "orange decoy",
      },
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[1]]: "blue decoy",
        [PLAYERS[2]]: "green decoy",
        [PLAYERS[3]]: "orange decoy",
      },
    });

    const command = new SubmitDecoy(round.id, PLAYERS[1], "blue decoy", now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: { generate: vi.fn() } as any,
      config,
      scheduler: scheduler as Scheduler,
    });

    expect(gateway.appendPrompt).toHaveBeenCalledWith(round.id, PLAYERS[1], "blue decoy");
    expect(gateway.shufflePrompts).toHaveBeenCalledWith(round.id, [
      [PLAYERS[0], "real prompt"],
      [PLAYERS[1], "blue decoy"],
      [PLAYERS[2], "green decoy"],
      [PLAYERS[3], "orange decoy"],
    ]);
    expect(gateway.saveRoundState).toHaveBeenCalledTimes(1);
    expect(gateway.saveRoundState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: round.id,
        phase: "voting",
        prompts: {
          [PLAYERS[0]]: "real prompt",
          [PLAYERS[1]]: "blue decoy",
          [PLAYERS[2]]: "green decoy",
          [PLAYERS[3]]: "orange decoy",
        },
        shuffledPrompts: [
          "real prompt",
          "blue decoy",
          "green decoy",
          "orange decoy",
        ],
        shuffledPromptOwners: [...PLAYERS],
      }),
    );

    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "PromptsReady",
      roundId: round.id,
      prompts: ["real prompt", "blue decoy", "green decoy", "orange decoy"],
      votingDurationMs: config.votingDurationMs,
      at: now,
    });
    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "PhaseChanged",
      phase: "voting",
      at: now,
    });
    expect(scheduler.scheduleTimeout).toHaveBeenCalledWith(
      round.id,
      "voting",
      config.votingDurationMs,
    );
  });

  it("does not transition when not all prompts have been submitted", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const scheduler = makeScheduler();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "guessing",
      startedAt: now - 5_000,
      prompts: {
        [PLAYERS[0]]: "real prompt",
      },
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[1]]: "blue decoy",
      },
    });

    const command = new SubmitDecoy(round.id, PLAYERS[1], "blue decoy", now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: { generate: vi.fn() } as any,
      config,
      scheduler: scheduler as Scheduler,
    });

    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });

  it("is idempotent when the decoy already exists", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const scheduler = makeScheduler();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "guessing",
      startedAt: now - 5_000,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[1]]: "blue decoy",
      },
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: false,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[1]]: "blue decoy",
      },
    });

    const command = new SubmitDecoy(round.id, PLAYERS[1], "blue decoy", now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: { generate: vi.fn() } as any,
      config,
      scheduler: scheduler as Scheduler,
    });

    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });

  it("throws when executed outside of the guessing phase", async () => {
    const gateway = makeGateway();
    const config = makeConfig();
    const scheduler = makeScheduler();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "prompt",
      startedAt: now - 5_000,
    };

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitDecoy(round.id, PLAYERS[1], "blue decoy", now);

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: makeBus() as MessageBus,
        imageGenerator: { generate: vi.fn() } as any,
        config,
        scheduler: scheduler as Scheduler,
      }),
    ).rejects.toThrow(/guessing phase/);
  });

  it("throws when the active player tries to submit a decoy", async () => {
    const gateway = makeGateway();
    const config = makeConfig();
    const scheduler = makeScheduler();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "guessing",
      startedAt: now - 5_000,
    };

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitDecoy(round.id, PLAYERS[0], "oops", now);

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: makeBus() as MessageBus,
        imageGenerator: { generate: vi.fn() } as any,
        config,
        scheduler: scheduler as Scheduler,
      }),
    ).rejects.toThrow(/Active player/);
  });

});
