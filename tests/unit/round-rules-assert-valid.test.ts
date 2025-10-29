import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryRoundGateway } from "../../src/adapters/in-memory/InMemoryRoundGateway.js";
import { assertValidRoundState } from "../../src/domain/entities/RoundRules.js";
import * as RoundRules from "../../src/domain/entities/RoundRules.js";
import { InvalidRoundStateError } from "../../src/domain/errors/InvalidRoundStateError.js";
import type { RoundState } from "../../src/domain/ports/RoundGateway.js";
import type { RoundPhase } from "../../src/domain/typedefs.js";
import { cloneState } from "../support/mocks.js";

const promptsOf = (value: Record<string, string>): Record<string, string> => value;
const votesOf = (value: Record<string, number>): Record<string, number> => value;
const scoresOf = (value: Record<string, number>): Record<string, number> => value;

type RoundOverrides = Partial<Omit<RoundState, "prompts" | "votes" | "scores">> & {
  readonly prompts?: Record<string, string>;
  readonly votes?: Record<string, number>;
  readonly scores?: Record<string, number>;
};

function makeState(overrides: RoundOverrides = {}): RoundState {
  return {
    id: "round-1",
    players: ["alice", "bob"] as const satisfies readonly string[],
    activePlayer: "alice",
    phase: "prompt",
    prompts: promptsOf({}),
    seed: 1,
    startedAt: 1,
    ...overrides,
  };
}

function expectInvalidState(overrides: RoundOverrides, reason: string): void {
  const state = makeState(overrides);
  let error: InvalidRoundStateError | null = null;
  try {
    assertValidRoundState(state);
  } catch (err) {
    error = err as InvalidRoundStateError;
  }

  expect(error).toBeInstanceOf(InvalidRoundStateError);
  expect(error?.reason).toBe(reason);
  expect(error?.state).toBe(state);
}

describe("assertValidRoundState", () => {
  it("accepts a valid prompt phase state", () => {
    const state = makeState();
    expect(() => assertValidRoundState(state)).not.toThrow();
  });

  it("rejects missing players", () => {
    expectInvalidState({ players: [] }, "invalid or missing players");
  });

  it("rejects duplicate player IDs", () => {
    expectInvalidState({ players: ["alice", "alice"] }, "duplicate player IDs");
  });

  it("rejects when active player is not listed", () => {
    expectInvalidState({ activePlayer: "charlie" }, "active player not in player list");
  });

  it("rejects unknown phases", () => {
    expectInvalidState({ phase: "lobby" as RoundPhase }, "invalid phase");
  });

  it("rejects non-positive startedAt timestamps", () => {
    expectInvalidState({ startedAt: 0 }, "missing or invalid start time");
  });

  it("rejects when the seed is missing", () => {
    expectInvalidState(
      { seed: Number.NaN } as Partial<RoundState>,
      "missing or invalid seed",
    );
  });

  it("rejects decoy prompts during prompt phase", () => {
    expectInvalidState(
      { prompts: promptsOf({ bob: "decoy" }) },
      "unexpected decoy prompt in prompt phase",
    );
  });

  it("rejects prompts from unknown players", () => {
    expectInvalidState(
      {
        phase: "guessing",
        prompts: promptsOf({
          alice: "real",
          charlie: "mystery",
        }),
        imageUrl: "https://example.com/image.png",
      },
      "prompt submitted by unknown player charlie",
    );
  });

  it("rejects non-string prompt values", () => {
    expectInvalidState(
      {
        phase: "guessing",
        prompts: promptsOf({
          alice: "real",
          bob: 42 as unknown as string,
        }),
        imageUrl: "https://example.com/image.png",
      },
      "invalid prompt value from bob",
    );
  });

  it("requires the real prompt once guessing begins", () => {
    expectInvalidState(
      {
        phase: "guessing",
        prompts: promptsOf({ bob: "decoy" }),
        imageUrl: "https://example.com/image.png",
      },
      "missing real prompt",
    );
  });

  it("requires an http(s) image URL from guessing phase onward", () => {
    expectInvalidState(
      {
        phase: "guessing",
        prompts: promptsOf({ alice: "real" }),
        imageUrl: "notaurl",
      },
      "missing or invalid image URL",
    );
  });

  it("requires shuffle order in voting phase and later", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: promptsOf({ alice: "real" }),
        imageUrl: "https://example.com/image.png",
      },
      "missing shuffle order",
    );
  });

  it("requires shuffle order length to match submitted prompts", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: promptsOf({ alice: "real" }),
        imageUrl: "https://example.com/image.png",
        shuffleOrder: [0, 1],
      },
      "shuffle order is not a valid permutation",
    );
  });

  it("rejects shuffle order containing non-integer entries", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: promptsOf({ alice: "real", bob: "decoy" }),
        imageUrl: "https://example.com/image.png",
        shuffleOrder: [0, Number.NaN],
      },
      "shuffle order is not a valid permutation",
    );
  });

  it("rejects shuffle order that is not a permutation", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: promptsOf({ alice: "real", bob: "decoy" }),
        imageUrl: "https://example.com/image.png",
        shuffleOrder: [0, 0],
      },
      "shuffle order is not a valid permutation",
    );
  });

  it("requires scores in the finished phase", () => {
    expectInvalidState(
      {
        phase: "finished",
        prompts: promptsOf({ alice: "real" }),
        imageUrl: "https://example.com/image.png",
        shuffleOrder: [0],
        votes: votesOf({ bob: 0 }),
      },
      "missing scores",
    );
  });

  it("requires a score entry for every player", () => {
    expectInvalidState(
      {
        phase: "finished",
        prompts: promptsOf({ alice: "real" }),
        imageUrl: "https://example.com/image.png",
        shuffleOrder: [0],
        votes: votesOf({ bob: 0 }),
        scores: scoresOf({ alice: 1 }),
      },
      "missing score entry for bob",
    );
  });

  it("requires recorded votes when scoring", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: promptsOf({ alice: "real" }),
        imageUrl: "https://example.com/image.png",
        shuffleOrder: [0],
        scores: scoresOf({ alice: 0, bob: 0 }),
      },
      "missing votes",
    );
  });

  it("rejects votes from unknown players", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: promptsOf({ alice: "real" }),
        imageUrl: "https://example.com/image.png",
        shuffleOrder: [0],
        votes: votesOf({ charlie: 0 }),
        scores: scoresOf({ alice: 0, bob: 0 }),
      },
      "vote from unknown player charlie",
    );
  });

  it("rejects votes recorded for the active player", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: promptsOf({ alice: "real" }),
        imageUrl: "https://example.com/image.png",
        shuffleOrder: [0],
        votes: votesOf({ alice: 0 }),
        scores: scoresOf({ alice: 0, bob: 0 }),
      },
      "active player vote recorded",
    );
  });

  it("rejects votes pointing to invalid prompt indices", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: promptsOf({ alice: "real" }),
        imageUrl: "https://example.com/image.png",
        shuffleOrder: [0],
        votes: votesOf({ bob: -1 }),
        scores: scoresOf({ alice: 0, bob: 0 }),
      },
      "invalid vote index from bob",
    );
  });

  it("enforces earlier phase requirements in later phases", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: promptsOf({ alice: "real" }),
        shuffleOrder: [0],
        votes: votesOf({ bob: 0 }),
        scores: scoresOf({ alice: 0, bob: 0 }),
      },
      "missing or invalid image URL",
    );
  });

  it("does not mutate the provided state", () => {
    const state = makeState({
      phase: "scoring",
      prompts: promptsOf({ alice: "real" }),
      imageUrl: "https://example.com/image.png",
      shuffleOrder: [0],
      votes: votesOf({ bob: 0 }),
      scores: scoresOf({ alice: 1, bob: 2 }),
    });
    const snapshot = cloneState(state);

    expect(() => assertValidRoundState(state)).not.toThrow();
    expect(state).toEqual(snapshot);
  });
});

describe("gateway integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("propagates validation errors when loading", async () => {
    const gateway = new InMemoryRoundGateway();
    const round = await gateway.startNewRound("game-1", ["alice", "bob"], "alice", 1);

    vi.spyOn(RoundRules, "assertValidRoundState").mockImplementation(() => {
      throw new InvalidRoundStateError("boom", round);
    });

    await expect(gateway.loadRoundState(round.id)).rejects.toEqual(
      expect.objectContaining({ reason: "boom" }),
    );
  });

  it("propagates validation errors when saving", async () => {
    const gateway = new InMemoryRoundGateway();
    const round = await gateway.startNewRound("game-1", ["alice", "bob"], "alice", 1);

    vi.spyOn(RoundRules, "assertValidRoundState").mockImplementation(() => {
      throw new InvalidRoundStateError("boom", round);
    });

    await expect(gateway.saveRoundState({ ...round, phase: "guessing" })).rejects.toEqual(
      expect.objectContaining({ reason: "boom" }),
    );
  });
});
