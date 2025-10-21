import { describe, expect, it } from "vitest";

import {
  generateShuffle,
  getShuffledPrompts,
  promptIndexToPlayerId,
} from "../../src/domain/entities/RoundRules.js";
import type { RoundState } from "../../src/domain/ports/RoundGateway.js";

const PLAYERS = ["giver", "blue", "green", "orange"] as const;

function makeState(overrides: Partial<RoundState> = {}): RoundState {
  return {
    id: "round-test",
    players: [...PLAYERS],
    activePlayer: PLAYERS[0],
    phase: "voting",
    prompts: {
      [PLAYERS[0]]: "real",
      [PLAYERS[1]]: "blue",
      [PLAYERS[2]]: "green",
    },
    seed: 123456,
    startedAt: 1,
    shuffleOrder: undefined,
    ...overrides,
  } as RoundState;
}

describe("RoundRules deterministic shuffle", () => {
  it("generates identical permutations for the same seed and prompts", () => {
    const state = makeState();
    const first = generateShuffle(state);
    const second = generateShuffle(state);
    expect(first).toEqual(second);
  });

  it("produces different permutations when the seed changes", () => {
    const state = makeState({ seed: 1 });
    const other = makeState({ seed: 2 });
    const first = generateShuffle(state);
    const second = generateShuffle(other);
    expect(first).not.toEqual(second);
  });

  it("ignores players without submitted prompts", () => {
    const state = makeState({
      prompts: {
        [PLAYERS[0]]: "real",
        [PLAYERS[2]]: "green",
      },
    });

    const order = generateShuffle(state);
    expect(order).toHaveLength(2);
    state.shuffleOrder = order;
    const prompts = getShuffledPrompts(state);
    expect(new Set(prompts)).toEqual(new Set(["real", "green"]));
  });

  it("maps prompt indices back to the submitting player", () => {
    const state = makeState({ seed: 42 });
    const order = generateShuffle(state);
    state.shuffleOrder = order;

    order.forEach((baseIndex, shuffledIndex) => {
      const playerId = promptIndexToPlayerId(state, shuffledIndex);
      expect(playerId).toBe(state.players[baseIndex]);
    });
  });
});
