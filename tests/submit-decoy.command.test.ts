import { describe, it, expect, vi } from "vitest";

import { SubmitDecoy } from "../src/domain/commands/SubmitDecoy";
import type { RoundGateway, RoundState } from "../src/domain/ports/RoundGateway";
import type { MessageBus } from "../src/domain/ports/MessageBus";
import { GameConfig } from "../src/domain/GameConfig";
import type { Scheduler } from "../src/domain/ports/Scheduler";
import { getShuffledPrompts } from "../src/domain/entities/RoundRules.js";

const makeGateway = () =>
  ({
    loadRoundState: vi.fn(),
    appendPrompt: vi.fn(),
    saveRoundState: vi.fn(),
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
      seed: 42,
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
    expect(gateway.saveRoundState).toHaveBeenCalledTimes(1);
    const savedState = gateway.saveRoundState.mock.calls[0]![0] as RoundState;
    expect(savedState.shuffleOrder).toBeDefined();
    expect(savedState.phase).toBe("voting");
    const derivedPrompts = getShuffledPrompts(savedState);
    expect(new Set(derivedPrompts)).toEqual(
      new Set([
        "real prompt",
        "blue decoy",
        "green decoy",
        "orange decoy",
      ]),
    );

    const promptsEvent = bus.publish.mock.calls.find(([, event]) => event.type === "PromptsReady");
    expect(promptsEvent?.[0]).toBe(`round:${round.id}`);
    expect(promptsEvent?.[1]).toMatchObject({
      roundId: round.id,
      votingDurationMs: config.votingDurationMs,
      at: now,
    });
    expect(promptsEvent?.[1].prompts).toEqual(derivedPrompts);
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
      seed: 42,
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
      seed: 42,
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
      seed: 42,
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
