import { describe, expect, it, afterEach, vi } from "vitest";
import { InMemoryRoundGateway } from "../../src/adapters/in-memory/InMemoryRoundGateway.js";
import { assertValidRoundState } from "../../src/domain/entities/RoundRules.js";
import { InvalidRoundStateError } from "../../src/domain/errors/InvalidRoundStateError.js";
import type { RoundPhase, RoundState } from "../../src/domain/ports/RoundGateway.js";
import * as RoundRules from "../../src/domain/entities/RoundRules.js";

function makeState(overrides: Partial<RoundState> = {}): RoundState {
  return {
    id: "round-1",
    players: ["alice", "bob"],
    activePlayer: "alice",
    phase: "prompt",
    prompts: {},
    startedAt: 1,
    ...overrides,
  };
}

function expectInvalidState(overrides: Partial<RoundState>, reason: string): void {
  const state = makeState(overrides);
  const error = (() => {
    try {
      assertValidRoundState(state);
      return null;
    } catch (err) {
      return err as InvalidRoundStateError;
    }
  })();

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
    expectInvalidState(
      { players: ["alice", "alice"] },
      "duplicate player IDs",
    );
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

  it("rejects decoy prompts during prompt phase", () => {
    expectInvalidState(
      { prompts: { bob: "decoy" } },
      "unexpected decoy prompt in prompt phase",
    );
  });

  it("rejects prompts from unknown players", () => {
    expectInvalidState(
      { prompts: { charlie: "mystery" } as RoundState["prompts"] },
      "prompt submitted by unknown player",
    );
  });

  it("rejects non-string prompt values", () => {
    expectInvalidState(
      { prompts: { alice: 42 } as unknown as RoundState["prompts"] },
      "invalid prompt value",
    );
  });

  it("requires the real prompt once guessing begins", () => {
    expectInvalidState(
      {
        phase: "guessing",
        prompts: { bob: "decoy" },
        imageUrl: "https://example.com/image.png",
      },
      "missing real prompt",
    );
  });

  it("requires an http(s) image URL from guessing phase onward", () => {
    expectInvalidState(
      {
        phase: "guessing",
        prompts: { alice: "real" },
        imageUrl: "notaurl",
      },
      "missing or invalid image URL",
    );
  });

  it("requires shuffled prompts in voting phase and later", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: [],
      },
      "missing shuffled prompts",
    );
  });

  it("requires shuffled prompt owners in voting phase and later", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real"],
      },
      "missing shuffled prompt owners",
    );
  });

  it("requires shuffled prompts length to match submitted prompts", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real", "extra"],
        shuffledPromptOwners: ["alice", "bob"],
      },
      "shuffled prompts do not match submitted prompts",
    );
  });

  it("requires shuffled prompt owners length to match prompts", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real"],
        shuffledPromptOwners: ["alice", "bob"],
      },
      "shuffled prompt owners do not match prompts",
    );
  });

  it("requires shuffled prompt values to match submitted prompts", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["decoy"],
        shuffledPromptOwners: ["alice"],
      },
      "shuffled prompts do not match submitted prompts",
    );
  });

  it("rejects shuffled prompt values when counts differ", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: { alice: "real", bob: "decoy" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real", "real"],
        shuffledPromptOwners: ["alice", "bob"],
      },
      "shuffled prompts do not match submitted prompts",
    );
  });

  it("rejects shuffled prompt owners that do not match the prompts", () => {
    expectInvalidState(
      {
        phase: "voting",
        prompts: { alice: "real", bob: "decoy" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real", "decoy"],
        shuffledPromptOwners: ["alice", "alice"],
      },
      "shuffled prompt owners do not match prompts",
    );
  });

  it("requires scores in the scoring phase", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real"],
        shuffledPromptOwners: ["alice"],
        votes: { bob: 0 },
      },
      "missing scores",
    );
  });

  it("requires a score entry for every player", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real"],
        shuffledPromptOwners: ["alice"],
        votes: { bob: 0 },
        scores: { alice: 1 },
      },
      "missing player score",
    );
  });

  it("requires recorded votes when scoring", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real"],
        shuffledPromptOwners: ["alice"],
        scores: { alice: 0, bob: 0 },
      },
      "missing votes",
    );
  });

  it("rejects votes from unknown players", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real"],
        shuffledPromptOwners: ["alice"],
        votes: { charlie: 0 } as RoundState["votes"],
        scores: { alice: 0, bob: 0 },
      },
      "vote from unknown player",
    );
  });

  it("rejects votes recorded for the active player", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real"],
        shuffledPromptOwners: ["alice"],
        votes: { alice: 0 },
        scores: { alice: 0, bob: 0 },
      },
      "active player vote recorded",
    );
  });

  it("rejects votes pointing to invalid prompt indices", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: { alice: "real" },
        imageUrl: "https://example.com/image.png",
        shuffledPrompts: ["real"],
        shuffledPromptOwners: ["alice"],
        votes: { bob: 5 },
        scores: { alice: 0, bob: 0 },
      },
      "invalid vote index recorded",
    );
  });

  it("enforces earlier phase requirements in later phases", () => {
    expectInvalidState(
      {
        phase: "scoring",
        prompts: { alice: "real" },
        shuffledPrompts: ["real"],
        shuffledPromptOwners: ["alice"],
        votes: { bob: 0 },
        scores: { alice: 0, bob: 0 },
      },
      "missing or invalid image URL",
    );
  });

  it("does not mutate the provided state", () => {
    const state = makeState({
      phase: "scoring",
      prompts: { alice: "real" },
      imageUrl: "https://example.com/image.png",
      shuffledPrompts: ["real"],
      shuffledPromptOwners: ["alice"],
      votes: { bob: 0 },
      scores: { alice: 1, bob: 2 },
    });
    const snapshot = structuredClone(state);

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
    const round = await gateway.startNewRound(["alice", "bob"], "alice", 1);

    vi.spyOn(RoundRules, "assertValidRoundState").mockImplementation(() => {
      throw new InvalidRoundStateError("boom", round);
    });

    await expect(gateway.loadRoundState(round.id)).rejects.toEqual(
      expect.objectContaining({ reason: "boom" }),
    );
  });

  it("propagates validation errors when saving", async () => {
    const gateway = new InMemoryRoundGateway();
    const round = await gateway.startNewRound(["alice", "bob"], "alice", 1);

    vi.spyOn(RoundRules, "assertValidRoundState").mockImplementation(() => {
      throw new InvalidRoundStateError("boom", round);
    });

    await expect(gateway.saveRoundState({ ...round, phase: "guessing" })).rejects.toEqual(
      expect.objectContaining({ reason: "boom" }),
    );
  });
});
