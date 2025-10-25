import { describe, expect, it } from "vitest";

import { createCommandContext } from "./support/mocks.js";
import { SubmitDecoy } from "../src/domain/commands/SubmitDecoy.js";
import {
  assertValidRoundState,
  getShuffledPrompts,
} from "../src/domain/entities/RoundRules.js";
import type { RoundState, ValidRoundState } from "../src/domain/ports/RoundGateway.js";

const PLAYERS = ["active", "blue", "green", "orange"] as const satisfies readonly string[];

describe("SubmitDecoy command", () => {
  it("stores a decoy and transitions to voting when all prompts are submitted", async () => {
    const context = createCommandContext();
    const { gateway, bus, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "guessing",
      startedAt: now - 5_000,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[2]]: "green decoy",
        [PLAYERS[3]]: "orange decoy",
      },
      seed: 42,
      imageUrl: "https://example.com/image.png",
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[1]]: "blue decoy",
        [PLAYERS[2]]: "green decoy",
        [PLAYERS[3]]: "orange decoy",
      },
    });

    const command = new SubmitDecoy(round.id, PLAYERS[1], "blue decoy", now);
    await command.execute(context);

    expect(gateway.appendPrompt).toHaveBeenCalledWith(round.id, PLAYERS[1], "blue decoy");
    expect(gateway.saveRoundState).toHaveBeenCalledTimes(1);
    const [savedState] = gateway.saveRoundState.mock.calls[0] ?? [];
    if (!savedState) {
      throw new Error("Expected round state to be saved");
    }
    expect(savedState.shuffleOrder).toBeDefined();
    expect(savedState.phase).toBe("voting");
    assertValidRoundState(savedState);
    const derivedPrompts = getShuffledPrompts(savedState);
    expect(new Set(derivedPrompts)).toEqual(
      new Set(["real prompt", "blue decoy", "green decoy", "orange decoy"]),
    );

    const promptsEvent = bus.publish.mock.calls.find(
      ([, event]: [string, object]) =>
        (event as Record<string, unknown>)["type"] === "PromptsReady",
    );
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

  it("does not transition when not all prompts have been submitted", async () => {
    const context = createCommandContext();
    const { gateway, bus, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "guessing",
      startedAt: now - 5_000,
      prompts: {
        [PLAYERS[0]]: "real prompt",
      },
      seed: 42,
      imageUrl: "https://example.com/image.png",
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[1]]: "blue decoy",
      },
    });

    const command = new SubmitDecoy(round.id, PLAYERS[1], "blue decoy", now);
    await command.execute(context);

    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });

  it("is idempotent when the decoy already exists", async () => {
    const context = createCommandContext();
    const { gateway, bus, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "guessing",
      startedAt: now - 5_000,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[1]]: "blue decoy",
      },
      seed: 42,
      imageUrl: "https://example.com/image.png",
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: false,
      prompts: {
        [PLAYERS[0]]: "real prompt",
        [PLAYERS[1]]: "blue decoy",
      },
    });

    const command = new SubmitDecoy(round.id, PLAYERS[1], "blue decoy", now);
    await command.execute(context);

    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });

  it("throws when executed outside of the guessing phase", async () => {
    const context = createCommandContext();
    const { gateway, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "prompt",
      startedAt: now - 5_000,
      seed: 42,
      prompts: {},
    };

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitDecoy(round.id, PLAYERS[1], "blue decoy", now);

    await expect(command.execute(context)).rejects.toThrow(/guessing phase/);
  });

  it("throws when the active player tries to submit a decoy", async () => {
    const context = createCommandContext();
    const { gateway, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: [...PLAYERS],
      activePlayer: PLAYERS[0],
      phase: "guessing",
      startedAt: now - 5_000,
      prompts: { [PLAYERS[0]]: "real prompt" },
      imageUrl: "https://example.com/image.png",
      seed: 42,
    };

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitDecoy(round.id, PLAYERS[0], "oops", now);

    await expect(command.execute(context)).rejects.toThrow(/Active player/);
  });
});
