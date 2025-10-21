import { describe, it, expect, vi } from "vitest";

import type { RoundGateway, RoundState } from "../src/domain/ports/RoundGateway";
import type { MessageBus } from "../src/domain/ports/MessageBus";
import { GameConfig } from "../src/domain/GameConfig";
import type { Scheduler } from "../src/domain/ports/Scheduler";
import { PhaseTimeout } from "../src/domain/commands/PhaseTimeout";
import { getShuffledPrompts } from "../src/domain/entities/RoundRules.js";

const makeGateway = () =>
  ({
    loadRoundState: vi.fn(),
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

const roundBase = (overrides: Partial<RoundState>): RoundState => ({
  id: "round-7",
  players: ["a", "b", "c", "d"],
  activePlayer: "a",
  phase: "guessing",
  startedAt: Date.now() - 10_000,
  prompts: { a: "real" },
  seed: 1234,
  votes: {},
  ...overrides,
});

describe("PhaseTimeout command", () => {
  it("advances from guessing to voting when the deadline passes", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const scheduler = makeScheduler();
    const now = Date.now();
    const round = roundBase({
      prompts: { a: "real", b: "decoy" },
    });

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new PhaseTimeout(round.id, "guessing", now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: { generate: vi.fn() } as any,
      config,
      scheduler: scheduler as Scheduler,
    });

    expect(gateway.saveRoundState).toHaveBeenCalledTimes(1);
    const savedState = gateway.saveRoundState.mock.calls[0]![0] as RoundState;
    expect(savedState.id).toBe(round.id);
    expect(savedState.phase).toBe("voting");
    expect(savedState.shuffleOrder).toBeDefined();
    expect(savedState.shuffleOrder).toHaveLength(2);

    const derivedPrompts = getShuffledPrompts(savedState);
    expect(new Set(derivedPrompts)).toEqual(new Set(["real", "decoy"]));

    const promptsEvent = bus.publish.mock.calls.find(([, event]) => event.type === "PromptsReady");
    expect(promptsEvent).toBeDefined();
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

  it("finishes the round when the prompt deadline passes without a submission", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const scheduler = makeScheduler();
    const now = Date.now();
    const round = roundBase({
      phase: "prompt",
      prompts: {},
    });

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new PhaseTimeout(round.id, "prompt", now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: { generate: vi.fn() } as any,
      config,
      scheduler: scheduler as Scheduler,
    });

    expect(gateway.saveRoundState).toHaveBeenCalledTimes(1);
    expect(gateway.saveRoundState).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "finished",
        finishedAt: now,
        scores: { a: 0, b: 0, c: 0, d: 0 },
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "RoundFinished",
      roundId: round.id,
      at: now,
      scores: { a: 0, b: 0, c: 0, d: 0 },
    });
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });

  it("finalizes the round when the voting deadline expires", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const scheduler = makeScheduler();
    const now = Date.now();
    const round = roundBase({
      phase: "voting",
      prompts: { a: "real", b: "decoy" },
      shuffleOrder: [0, 1],
      votes: { b: 1 },
    });

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new PhaseTimeout(round.id, "voting", now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: { generate: vi.fn() } as any,
      config,
      scheduler: scheduler as Scheduler,
    });

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
      scores: { a: 0, b: 3, c: 0, d: 0 },
    });
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });

  it("does nothing when the stored phase does not match", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const scheduler = makeScheduler();
    const now = Date.now();
    const round = roundBase({ phase: "voting" });

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new PhaseTimeout(round.id, "guessing", now);
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
});
