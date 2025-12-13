import { describe, expect, it } from "vitest";

import { createGameConfig } from "../src/domain/GameConfig.js";
import { PhaseTimeout } from "../src/mvcc/commands/PhaseTimeout.js";
import { SetRoundImage } from "../src/mvcc/commands/SetRoundImage.js";
import { StartNextRound } from "../src/mvcc/commands/StartNextRound.js";
import { SubmitDecoy } from "../src/mvcc/commands/SubmitDecoy.js";
import { SubmitPrompt } from "../src/mvcc/commands/SubmitPrompt.js";
import { SubmitVote } from "../src/mvcc/commands/SubmitVote.js";
import { CommandError } from "../src/mvcc/errors.js";
import type { GameState, PlayerId, RoundState } from "../src/mvcc/types.js";
import { assertValidGameState } from "../src/mvcc/validators.js";

describe("StartNextRound (pure)", () => {
  it("rejects when a round is already active", () => {
    const state = makeGameState({
      currentRound: {
        id: "round-1",
        state: makeRoundState({ phase: "guessing", imageUrl: "https://example.com/img" }),
      },
    });

    const cmd = new StartNextRound("round-2", "p1", 123, 10);
    const res = cmd.apply(state);

    expect(res.kind).toBe("rejected");
    expect((res as { error: Error }).error).toBeInstanceOf(CommandError);
  });

  it("creates a new round when idle", () => {
    const state = makeGameState();
    const cmd = new StartNextRound("round-2", "p2", 7, 20);

    const res = cmd.apply(state);
    if (res.kind !== "ok") throw new Error("expected ok");

    expectValidState(res.state);
    expect(res.state.currentRound?.id).toBe("round-2");
    expect(res.state.currentRound?.state.phase).toBe("prompt");
    expect(res.state.currentRound?.state.prompts).toEqual({});
    expect(res.state.currentRound?.state.activePlayer).toBe("p2");
  });
});

describe("SubmitPrompt (pure)", () => {
  it("rejects submission from non-active player", () => {
    const round = makeRoundState({ phase: "prompt" });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });
    const cmd = new SubmitPrompt(round.id, "p2", "real prompt");

    const res = cmd.apply(state);
    expect(res.kind).toBe("rejected");
  });

  it("rejects changed prompt when already set", () => {
    const round = makeRoundState({
      phase: "prompt",
      prompts: { p1: "real prompt" },
    });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });
    const cmd = new SubmitPrompt(round.id, "p1", "other");

    const res = cmd.apply(state);
    expect(res.kind).toBe("rejected");
  });

  it("stores the prompt and remains in prompt phase", () => {
    const round = makeRoundState({ phase: "prompt" });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });
    const cmd = new SubmitPrompt(round.id, "p1", "real prompt");

    const res = cmd.apply(state);
    if (res.kind !== "ok") throw new Error("expected ok");

    expectValidState(res.state);
    expect(res.state.currentRound?.state.prompts).toEqual({ p1: "real prompt" });
    expect(res.state.currentRound?.state.phase).toBe("prompt");
  });
});

describe("SetRoundImage (pure)", () => {
  it("rejects when prompt not yet submitted", () => {
    const round = makeRoundState({ phase: "prompt", prompts: {} });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });
    const cmd = new SetRoundImage(round.id, "https://img");

    const res = cmd.apply(state);
    expect(res.kind).toBe("rejected");
  });

  it("rejects when image already set with different URL", () => {
    const round = makeRoundState({
      phase: "prompt",
      prompts: { p1: "real" },
      imageUrl: "https://img",
    });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });
    const cmd = new SetRoundImage(round.id, "https://other");

    const res = cmd.apply(state);
    expect(res.kind).toBe("rejected");
  });

  it("moves to guessing once image is set", () => {
    const round = makeRoundState({ phase: "prompt", prompts: { p1: "real" } });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });
    const cmd = new SetRoundImage(round.id, "https://img");

    const res = cmd.apply(state);
    if (res.kind !== "ok") throw new Error("expected ok");

    expectValidState(res.state);
    expect(res.state.currentRound?.state.phase).toBe("guessing");
    expect(res.state.currentRound?.state.imageUrl).toBe("https://img");
  });
});

describe("SubmitDecoy (pure)", () => {
  it("rejects when active player attempts decoy", () => {
    const round = makeRoundState({
      phase: "guessing",
      prompts: { p1: "real" },
      imageUrl: "https://example.com/img",
    });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });

    const res = new SubmitDecoy(round.id, "p1", "decoy").apply(state);

    expect(res.kind).toBe("rejected");
  });

  it("rejects when submitting a different decoy twice", () => {
    const round = makeRoundState({
      phase: "guessing",
      prompts: { p1: "real", p2: "decoy" },
      imageUrl: "https://example.com/img",
    });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });

    const res = new SubmitDecoy(round.id, "p2", "other-decoy").apply(state);

    expect(res.kind).toBe("rejected");
  });

  it("promotes to voting when all prompts are in", () => {
    const round = makeRoundState({
      phase: "guessing",
      prompts: { p1: "real" },
      imageUrl: "https://example.com/img",
    });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });

    const first = new SubmitDecoy(round.id, "p2", "decoy-2").apply(state);
    if (first.kind !== "ok") throw new Error("expected ok");
    expectValidState(first.state);
    expect(first.state.currentRound?.state.phase).toBe("guessing");

    const second = new SubmitDecoy(round.id, "p3", "decoy-3").apply(first.state);
    if (second.kind !== "ok") throw new Error("expected ok");
    expectValidState(second.state);
    const nextRound = second.state.currentRound?.state;
    expect(nextRound?.phase).toBe("voting");
    expect(nextRound?.shuffleOrder).toHaveLength(3);
    expect(nextRound?.votes).toEqual({});
  });
});

describe("SubmitVote (pure)", () => {
  it("rejects duplicate vote with different value", () => {
    const prompts = { p1: "real", p2: "d2", p3: "d3" };
    const round: RoundState = {
      ...makeRoundState({
        phase: "voting",
        prompts,
        imageUrl: "https://example.com/img",
      }),
      shuffleOrder: [0, 1, 2],
      votes: { p2: 0 },
    };
    const state = makeGameState({ currentRound: { id: round.id, state: round } });

    const res = new SubmitVote(round.id, "p2", 1).apply(state);

    expect(res.kind).toBe("rejected");
  });

  it("finalizes scores when all votes are in", () => {
    const prompts = { p1: "real", p2: "d2", p3: "d3" };
    const round: RoundState = {
      ...makeRoundState({
        phase: "voting",
        prompts,
        imageUrl: "https://example.com/img",
      }),
      shuffleOrder: [0, 1, 2],
      votes: {},
    };
    const state = makeGameState({ currentRound: { id: round.id, state: round } });

    const afterP2 = new SubmitVote(round.id, "p2", 0).apply(state);
    if (afterP2.kind !== "ok") throw new Error("expected ok");
    expectValidState(afterP2.state);
    expect(afterP2.state.currentRound?.state.votes).toEqual({ p2: 0 });
    expect(afterP2.state.currentRound?.state.phase).toBe("voting");

    const afterP3 = new SubmitVote(round.id, "p3", 1).apply(afterP2.state);
    if (afterP3.kind !== "ok") throw new Error("expected ok");
    expectValidState(afterP3.state);
    const finished = afterP3.state.currentRound?.state;
    expect(finished?.phase).toBe("finished");
    expect(finished?.scores).toEqual({ p1: 3, p2: 4, p3: 0 });
  });
});

describe("PhaseTimeout (pure)", () => {
  it("marks prompt timeouts as finished with zero scores", () => {
    const round = makeRoundState({ phase: "prompt" });
    const state = makeGameState({ currentRound: { id: round.id, state: round } });
    const cmd = new PhaseTimeout(round.id, "prompt");

    const res = cmd.apply(state);
    if (res.kind !== "ok") throw new Error("expected ok");
    expectValidState(res.state);
    const finished = res.state.currentRound?.state;
    expect(finished?.phase).toBe("finished");
    expect(finished?.scores).toEqual({ p1: 0, p2: 0, p3: 0 });
    expect(finished?.prompts?.[round.activePlayer]).toBe("[prompt timed out]");
    expect(finished?.imageUrl).toMatch(/^https?:\/\//);
  });

  it("scores existing votes on voting timeout", () => {
    const round = {
      ...makeRoundState({
        phase: "voting",
        prompts: { p1: "real", p2: "d2", p3: "d3" },
        imageUrl: "https://example.com/img",
      }),
      shuffleOrder: [0, 1, 2],
      votes: { p2: 0 },
    };
    const state = makeGameState({ currentRound: { id: round.id, state: round } });
    const cmd = new PhaseTimeout(round.id, "voting");

    const res = cmd.apply(state);
    if (res.kind !== "ok") throw new Error("expected ok");
    expectValidState(res.state);
    const finished = res.state.currentRound?.state;
    expect(finished?.phase).toBe("finished");
    expect(finished?.scores).toEqual({ p1: 0, p2: 5, p3: 0 });
  });
});

function makeRoundState(overrides: Partial<RoundState> = {}): RoundState {
  const base: RoundState = {
    id: "round-1",
    players: ["p1", "p2", "p3"],
    activePlayer: "p1",
    phase: "prompt",
    seed: 1,
    startedAt: 1,
    prompts: {},
    votes: {},
    scores: {},
  };

  return { ...base, ...overrides };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const base: GameState = {
    id: "game-1",
    lobby: {
      host: "p1",
      players: ["p1", "p2", "p3"],
      config: createGameConfig(),
    },
  };

  return { ...base, ...overrides };
}

function expectValidState(state: GameState): void {
  expect(() => assertValidGameState(state)).not.toThrow();
}
