import { describe, expect, it, vi } from "vitest";

import { createGameConfig } from "../src/domain/GameConfig.js";
import { PhaseSchedulerReactor } from "../src/mvcc/reactors/PhaseSchedulerReactor.js";
import type { GameReactorContext } from "../src/mvcc/reactors.js";
import type { GameState, RoundState } from "../src/mvcc/types.js";

describe("PhaseSchedulerReactor", () => {
  it("schedules prompt timeout only when entering prompt for a round", async () => {
    const reactor = new PhaseSchedulerReactor();
    const scheduler = { scheduleTimeout: vi.fn(async () => {}) };
    const ctx = makeCtx({ scheduler });

    const before = makeGameState({
      roundId: "round-1",
      phase: "prompt",
    });
    const afterSameRound = makeGameState({
      roundId: "round-1",
      phase: "prompt",
    });

    await reactor.handle({ before, after: afterSameRound }, ctx, "ok");
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();

    const afterNewRound = makeGameState({
      roundId: "round-2",
      phase: "prompt",
    });

    await reactor.handle({ before, after: afterNewRound }, ctx, "ok");
    expect(scheduler.scheduleTimeout).toHaveBeenCalledWith(
      "round-2",
      "prompt",
      afterNewRound.lobby.config.promptDurationMs,
      afterNewRound.id,
    );
  });
});

function makeCtx(overrides: Partial<GameReactorContext>): GameReactorContext {
  return {
    bus: { publish: vi.fn(async () => {}) },
    scheduler: { scheduleTimeout: vi.fn(async () => {}) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    service: { run: vi.fn(async () => {}) },
    ...overrides,
  };
}

function makeGameState({
  roundId,
  phase,
}: {
  roundId: string;
  phase: RoundState["phase"];
}): GameState {
  const config = createGameConfig({
    promptDurationMs: 1_000,
    guessingDurationMs: 2_000,
    votingDurationMs: 3_000,
  });

  return {
    id: "game-1",
    lobby: { host: "p1", players: ["p1"], config },
    currentRound: {
      id: roundId,
      state: {
        id: roundId,
        players: ["p1", "p2"],
        activePlayer: "p1",
        phase,
        seed: 1,
        startedAt: 1,
      },
    },
  };
}
