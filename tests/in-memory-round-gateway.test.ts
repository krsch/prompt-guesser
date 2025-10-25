import { describe, expect, it } from "vitest";

import { InMemoryRoundGateway } from "../src/adapters/in-memory/InMemoryRoundGateway.js";

const PLAYERS = ["alice", "bob", "carol", "dave"];
const ACTIVE = PLAYERS[0];

const START_AT = Date.UTC(2024, 0, 1, 12, 0, 0);
describe("InMemoryRoundGateway", () => {
  it("starts and persists a new round with initial state", async () => {
    const gateway = new InMemoryRoundGateway();
    const round = await gateway.startNewRound(
      PLAYERS,
      ACTIVE,
      START_AT,
    );

    expect(round).toMatchObject({
      id: expect.stringMatching(/^round-/),
      players: PLAYERS,
      activePlayer: ACTIVE,
      phase: "prompt",
      startedAt: START_AT,
      prompts: {},
      seed: expect.any(Number),
    });

    const reloaded = await gateway.loadRoundState(round.id);
    expect(reloaded).toEqual(round);
  });

  it("appends prompts atomically and returns the updated snapshot", async () => {
    const gateway = new InMemoryRoundGateway();
    const { id } = await gateway.startNewRound(
      PLAYERS,
      ACTIVE,
      START_AT,
    );

    const countAfterActive = await gateway.appendPrompt(id, ACTIVE, "real prompt");
    expect(countAfterActive).toEqual({
      inserted: true,
      prompts: { [ACTIVE]: "real prompt" },
    });

    const countAfterDuplicate = await gateway.appendPrompt(id, ACTIVE, "real prompt");
    expect(countAfterDuplicate).toEqual({
      inserted: false,
      prompts: { [ACTIVE]: "real prompt" },
    });

    await gateway.saveRoundState({
      ...(await gateway.loadRoundState(id)),
      phase: "guessing",
      imageUrl: "https://example.com/image.png",
    });

    const countAfterDecoy = await gateway.appendPrompt(id, PLAYERS[1], "decoy");
    expect(countAfterDecoy).toEqual({
      inserted: true,
      prompts: { [ACTIVE]: "real prompt", [PLAYERS[1]]: "decoy" },
    });

    await expect(
      gateway.appendPrompt(id, PLAYERS[1], "better decoy"),
    ).rejects.toThrowError(/existing prompt/i);

    const state = await gateway.loadRoundState(id);
    expect(state.prompts).toEqual({
      [ACTIVE]: "real prompt",
      [PLAYERS[1]]: "decoy",
    });
  });

  it("appends votes atomically and returns the updated snapshot", async () => {
    const gateway = new InMemoryRoundGateway();
    const { id } = await gateway.startNewRound(
      PLAYERS,
      ACTIVE,
      START_AT,
    );

    const firstVote = await gateway.appendVote(id, PLAYERS[1], 0);
    expect(firstVote).toEqual({
      inserted: true,
      votes: { [PLAYERS[1]]: 0 },
    });

    const secondVote = await gateway.appendVote(id, PLAYERS[2], 2);
    expect(secondVote).toEqual({
      inserted: true,
      votes: { [PLAYERS[1]]: 0, [PLAYERS[2]]: 2 },
    });

    const duplicate = await gateway.appendVote(id, PLAYERS[2], 2);
    expect(duplicate).toEqual({
      inserted: false,
      votes: { [PLAYERS[1]]: 0, [PLAYERS[2]]: 2 },
    });

    await expect(gateway.appendVote(id, PLAYERS[2], 1)).rejects.toThrowError(/existing vote/i);

    const state = await gateway.loadRoundState(id);
    expect(state.votes).toEqual({
      [PLAYERS[1]]: 0,
      [PLAYERS[2]]: 2,
    });
  });

  it("saves full round state snapshots", async () => {
    const gateway = new InMemoryRoundGateway();
    const state = await gateway.startNewRound(
      PLAYERS,
      ACTIVE,
      START_AT,
    );

    await gateway.appendPrompt(state.id, ACTIVE, "real prompt");

    const updated = {
      ...state,
      phase: "guessing" as const,
      shuffleOrder: [0],
      imageUrl: "https://example.com/image.png",
      prompts: { [ACTIVE]: "real prompt" },
    };

    await gateway.saveRoundState(updated);

    const reloaded = await gateway.loadRoundState(state.id);
    expect(reloaded).toMatchObject({
      phase: "guessing",
      shuffleOrder: [0],
      imageUrl: "https://example.com/image.png",
      prompts: {},
    });
  });

  it("counts submitted prompts", async () => {
    const gateway = new InMemoryRoundGateway();
    const { id } = await gateway.startNewRound(
      PLAYERS,
      ACTIVE,
      START_AT,
    );

    expect(await gateway.countSubmittedPrompts(id)).toBe(0);

    await gateway.appendPrompt(id, ACTIVE, "real prompt");

    await gateway.saveRoundState({
      ...(await gateway.loadRoundState(id)),
      phase: "guessing",
      imageUrl: "https://example.com/image.png",
    });

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
        seed: 0,
      } as any),
    ).rejects.toThrowError();
  });
});
