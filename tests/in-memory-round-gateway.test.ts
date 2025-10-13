import { describe, expect, it, vi } from "vitest";

import { InMemoryRoundGateway } from "../src/adapters/in-memory/InMemoryRoundGateway.js";

const PLAYERS = ["alice", "bob", "carol", "dave"];
const ACTIVE = PLAYERS[0];

const START_AT = Date.UTC(2024, 0, 1, 12, 0, 0);

describe("InMemoryRoundGateway", () => {
  it("starts and persists a new round with initial state", async () => {
    const gateway = new InMemoryRoundGateway();
    vi.useFakeTimers();
    let state: Awaited<ReturnType<InMemoryRoundGateway["startNewRound"]>> | undefined;
    try {
      vi.setSystemTime(new Date(START_AT));
      state = await gateway.startNewRound(PLAYERS, ACTIVE);
    } finally {
      vi.useRealTimers();
    }

    const round = state!;

    expect(round).toMatchObject({
      id: expect.stringMatching(/^round-/),
      players: PLAYERS,
      activePlayer: ACTIVE,
      phase: "prompt",
      startedAt: START_AT,
      prompts: {},
    });

    expect(round.promptDeadline).toBeUndefined();

    expect(round.votes).toBeUndefined();

    const reloaded = await gateway.loadRoundState(round.id);
    expect(reloaded).toEqual(round);
  });

  it("appends prompts atomically and returns the updated count per player", async () => {
    const gateway = new InMemoryRoundGateway();
    const { id } = await gateway.startNewRound(PLAYERS, ACTIVE);

    const countAfterActive = await gateway.appendPrompt(id, ACTIVE, "real prompt");
    expect(countAfterActive).toEqual({ count: 1, inserted: true });

    const countAfterDuplicate = await gateway.appendPrompt(id, ACTIVE, "real prompt");
    expect(countAfterDuplicate).toEqual({ count: 1, inserted: false });

    const countAfterDecoy = await gateway.appendPrompt(id, PLAYERS[1], "decoy");
    expect(countAfterDecoy).toEqual({ count: 2, inserted: true });

    await expect(
      gateway.appendPrompt(id, PLAYERS[1], "better decoy"),
    ).rejects.toThrowError(/existing prompt/i);

    const state = await gateway.loadRoundState(id);
    expect(state.prompts).toEqual({
      [ACTIVE]: "real prompt",
      [PLAYERS[1]]: "decoy",
    });
  });

  it("appends votes atomically and returns the updated count per player", async () => {
    const gateway = new InMemoryRoundGateway();
    const { id } = await gateway.startNewRound(PLAYERS, ACTIVE);

    const firstVote = await gateway.appendVote(id, PLAYERS[1], 0);
    expect(firstVote).toBe(1);

    const secondVote = await gateway.appendVote(id, PLAYERS[2], 2);
    expect(secondVote).toBe(2);

    const duplicate = await gateway.appendVote(id, PLAYERS[2], 2);
    expect(duplicate).toBe(2);

    await expect(gateway.appendVote(id, PLAYERS[2], 1)).rejects.toThrowError(/existing vote/i);

    const state = await gateway.loadRoundState(id);
    expect(state.votes).toEqual({
      [PLAYERS[1]]: 0,
      [PLAYERS[2]]: 2,
    });
  });

  it("saves full round state snapshots", async () => {
    const gateway = new InMemoryRoundGateway();
    const state = await gateway.startNewRound(PLAYERS, ACTIVE);

    const updated = {
      ...state,
      phase: "guessing" as const,
      prompts: { [ACTIVE]: "real" },
    };

    await gateway.saveRoundState(updated);

    const reloaded = await gateway.loadRoundState(state.id);
    expect(reloaded).toEqual(updated);
  });

  it("counts submitted prompts", async () => {
    const gateway = new InMemoryRoundGateway();
    const { id } = await gateway.startNewRound(PLAYERS, ACTIVE);

    expect(await gateway.countSubmittedPrompts(id)).toBe(0);

    await gateway.appendPrompt(id, ACTIVE, "real prompt");
    await gateway.appendPrompt(id, PLAYERS[1], "decoy");

    expect(await gateway.countSubmittedPrompts(id)).toBe(2);
  });

  it("throws when operating on an unknown round", async () => {
    const gateway = new InMemoryRoundGateway();
    await expect(gateway.loadRoundState("missing")).rejects.toThrowError();
    await expect(gateway.appendPrompt("missing", ACTIVE, "x")).rejects.toThrowError();
    await expect(gateway.appendVote("missing", ACTIVE, 0)).rejects.toThrowError();
    await expect(gateway.countSubmittedPrompts("missing")).rejects.toThrowError();
    await expect(
      gateway.saveRoundState({
        id: "missing",
        players: PLAYERS,
        activePlayer: ACTIVE,
        phase: "prompt",
        startedAt: START_AT,
      } as any),
    ).rejects.toThrowError();
  });
});
