import { describe, expect, it } from "vitest";

import { InMemoryRoundGateway } from "../src/adapters/in-memory/InMemoryRoundGateway.js";

const PLAYERS = ["alice", "bob", "carol", "dave"];
const ACTIVE = PLAYERS[0];

const START_AT = Date.UTC(2024, 0, 1, 12, 0, 0);
const PROMPT_DEADLINE = START_AT + 60_000;

describe("InMemoryRoundGateway", () => {
  it("starts and persists a new round with initial state", async () => {
    const gateway = new InMemoryRoundGateway();
    const state = await gateway.startNewRound(PLAYERS, ACTIVE, PROMPT_DEADLINE, START_AT);

    expect(state).toMatchObject({
      id: expect.stringMatching(/^round-/),
      players: PLAYERS,
      activePlayer: ACTIVE,
      phase: "prompt",
      startedAt: START_AT,
      promptDeadline: PROMPT_DEADLINE,
      prompts: {},
    });

    expect(state.votes).toBeUndefined();

    const reloaded = await gateway.loadRoundState(state.id);
    expect(reloaded).toEqual(state);
  });

  it("appends prompts atomically and returns the updated count per player", async () => {
    const gateway = new InMemoryRoundGateway();
    const { id } = await gateway.startNewRound(PLAYERS, ACTIVE, PROMPT_DEADLINE, START_AT);

    const firstAt = START_AT + 5_000;
    const countAfterActive = await gateway.appendPrompt(id, ACTIVE, "real prompt", firstAt);
    expect(countAfterActive).toBe(1);

    const countAfterDuplicate = await gateway.appendPrompt(id, ACTIVE, "real prompt", firstAt + 1);
    expect(countAfterDuplicate).toBe(1);

    const countAfterDecoy = await gateway.appendPrompt(id, PLAYERS[1], "decoy", firstAt + 2);
    expect(countAfterDecoy).toBe(2);

    await expect(
      gateway.appendPrompt(id, PLAYERS[1], "better decoy", firstAt + 3),
    ).rejects.toThrowError(/existing prompt/i);

    const state = await gateway.loadRoundState(id);
    expect(state.prompts).toEqual({
      [ACTIVE]: "real prompt",
      [PLAYERS[1]]: "decoy",
    });
  });

  it("appends votes atomically and returns the updated count per player", async () => {
    const gateway = new InMemoryRoundGateway();
    const { id } = await gateway.startNewRound(PLAYERS, ACTIVE, PROMPT_DEADLINE, START_AT);

    const base = START_AT + 10_000;
    const firstVote = await gateway.appendVote(id, PLAYERS[1], 0, base);
    expect(firstVote).toBe(1);

    const secondVote = await gateway.appendVote(id, PLAYERS[2], 2, base + 1);
    expect(secondVote).toBe(2);

    const duplicate = await gateway.appendVote(id, PLAYERS[2], 2, base + 2);
    expect(duplicate).toBe(2);

    await expect(gateway.appendVote(id, PLAYERS[2], 1, base + 3)).rejects.toThrowError(/existing vote/i);

    const state = await gateway.loadRoundState(id);
    expect(state.votes).toEqual({
      [PLAYERS[1]]: 0,
      [PLAYERS[2]]: 2,
    });
  });

  it("saves full round state snapshots", async () => {
    const gateway = new InMemoryRoundGateway();
    const state = await gateway.startNewRound(PLAYERS, ACTIVE, PROMPT_DEADLINE, START_AT);

    const updated = {
      ...state,
      phase: "guessing" as const,
      prompts: { [ACTIVE]: "real" },
    };

    await gateway.saveRoundState(updated, START_AT + 20_000);

    const reloaded = await gateway.loadRoundState(state.id);
    expect(reloaded).toEqual(updated);
  });

  it("counts submitted prompts", async () => {
    const gateway = new InMemoryRoundGateway();
    const { id } = await gateway.startNewRound(PLAYERS, ACTIVE, PROMPT_DEADLINE, START_AT);

    expect(await gateway.countSubmittedPrompts(id)).toBe(0);

    await gateway.appendPrompt(id, ACTIVE, "real prompt", START_AT + 2_000);
    await gateway.appendPrompt(id, PLAYERS[1], "decoy", START_AT + 3_000);

    expect(await gateway.countSubmittedPrompts(id)).toBe(2);
  });

  it("throws when operating on an unknown round", async () => {
    const gateway = new InMemoryRoundGateway();
    await expect(gateway.loadRoundState("missing")).rejects.toThrowError();
    await expect(gateway.appendPrompt("missing", ACTIVE, "x", START_AT)).rejects.toThrowError();
    await expect(gateway.appendVote("missing", ACTIVE, 0, START_AT)).rejects.toThrowError();
    await expect(gateway.countSubmittedPrompts("missing")).rejects.toThrowError();
    await expect(
      gateway.saveRoundState({
        id: "missing",
        players: PLAYERS,
        activePlayer: ACTIVE,
        phase: "prompt",
        startedAt: START_AT,
      } as any, START_AT),
    ).rejects.toThrowError();
  });
});
