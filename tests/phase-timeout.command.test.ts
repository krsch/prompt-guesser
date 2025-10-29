import { describe, expect, it } from "vitest";

import { createCommandContext } from "./support/mocks.js";
import { PhaseTimeout } from "../src/domain/commands/PhaseTimeout.js";
import {
  assertValidRoundState,
  getShuffledPrompts,
} from "../src/domain/entities/RoundRules.js";
import type { RoundState, ValidRoundState } from "../src/domain/ports/RoundGateway.js";
import { createGameConfig } from "../src/domain/GameConfig.js";

type RoundOverrides = Partial<Omit<RoundState, "prompts" | "votes">> & {
  readonly prompts?: Record<string, string>;
  readonly votes?: Record<string, number>;
};

const roundBase = (overrides: RoundOverrides = {}): RoundState => ({
  id: "round-7",
  gameId: "game-1",
  players: ["a", "b", "c", "d"] as const satisfies readonly string[],
  activePlayer: "a",
  phase: "guessing",
  startedAt: Date.now() - 10_000,
  prompts: { a: "real" } as Record<string, string>,
  seed: 1234,
  votes: {} as Record<string, number>,
  imageUrl: "https://example.com/image.png",
  ...overrides,
});

describe("PhaseTimeout command", () => {
  it("advances from guessing to voting when the deadline passes", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, config, scheduler } = context;
    const now = Date.now();
    const round = roundBase({
      prompts: { a: "real", b: "decoy" },
    });

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);
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

    const command = new PhaseTimeout(round.id, "guessing", now);
    await command.execute(context);

    expect(roundGateway.saveRoundState).toHaveBeenCalledTimes(1);
    const [savedState] = roundGateway.saveRoundState.mock.calls[0] ?? [];
    if (!savedState) {
      throw new Error("Expected round state to be saved");
    }
    expect(savedState.id).toBe(round.id);
    expect(savedState.phase).toBe("voting");
    expect(savedState.shuffleOrder).toBeDefined();
    expect(savedState.shuffleOrder).toHaveLength(2);

    assertValidRoundState(savedState);
    const derivedPrompts = getShuffledPrompts(savedState);
    expect(new Set(derivedPrompts)).toEqual(new Set(["real", "decoy"]));

    const promptsEvent = bus.publish.mock.calls.find(
      ([, event]: [string, object]) =>
        (event as Record<string, unknown>)["type"] === "PromptsReady",
    );
    expect(promptsEvent).toBeDefined();
    expect(promptsEvent?.[0]).toBe(`round:${round.id}`);
    expect(promptsEvent?.[1]).toMatchObject({
      roundId: round.id,
      votingDurationMs: config.votingDurationMs,
      at: now,
    });
    const promptsPayload = promptsEvent?.[1] as Record<string, unknown> | undefined;
    expect(promptsPayload?.["prompts"]).toEqual(derivedPrompts);

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
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, config, scheduler } = context;
    const now = Date.now();
    const round = roundBase({
      phase: "prompt",
      prompts: {},
    });

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);
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

    const command = new PhaseTimeout(round.id, "prompt", now);
    await command.execute(context);

    expect(roundGateway.saveRoundState).toHaveBeenCalledTimes(1);
    expect(roundGateway.saveRoundState).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "finished",
        finishedAt: now,
        scores: { a: 0, b: 0, c: 0, d: 0 },
      }),
    );
    expect(bus.publish).toHaveBeenNthCalledWith(1, `round:${round.id}`, {
      type: "PhaseChanged",
      phase: "finished",
      at: now,
    });
    expect(bus.publish).toHaveBeenNthCalledWith(2, `round:${round.id}`, {
      type: "RoundFinished",
      roundId: round.id,
      at: now,
      scores: { a: 0, b: 0, c: 0, d: 0 },
    });
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });

  it("finalizes the round when the voting deadline expires", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, config, scheduler } = context;
    const now = Date.now();
    const round = roundBase({
      phase: "voting",
      prompts: { a: "real", b: "decoy" },
      shuffleOrder: [0, 1],
      votes: { b: 1 },
    });

    roundGateway.loadRoundState.mockResolvedValue(round as ValidRoundState);
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

    const command = new PhaseTimeout(round.id, "voting", now);
    await command.execute(context);

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
      scores: { a: 0, b: 3, c: 0, d: 0 },
    });
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });

  it("does nothing when the stored phase does not match", async () => {
    const context = createCommandContext();
    const { roundGateway, gameGateway, bus, config, scheduler } = context;
    const now = Date.now();
    const round = roundBase({ phase: "voting" });

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

    const command = new PhaseTimeout(round.id, "guessing", now);
    await command.execute(context);

    expect(roundGateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });
});
