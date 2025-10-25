import { describe, expect, it } from "vitest";

import { createCommandContext } from "./support/mocks.js";
import { SubmitPrompt } from "../src/domain/commands/SubmitPrompt.js";
import type { RoundState, ValidRoundState } from "../src/domain/ports/RoundGateway.js";

describe("SubmitPrompt command", () => {
  it("stores the prompt, generates the image, advances the phase to guessing and publishes events", async () => {
    const context = createCommandContext();
    const { gateway, bus, imageGenerator, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      seed: 42,
      prompts: {},
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: { [round.activePlayer]: "real prompt" },
    });
    imageGenerator.generate.mockResolvedValue("https://example.com/image.png");

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);
    await command.execute(context);

    expect(gateway.loadRoundState).toHaveBeenCalledWith(round.id);
    expect(gateway.appendPrompt).toHaveBeenCalledWith(
      round.id,
      round.activePlayer,
      "real prompt",
    );
    expect(imageGenerator.generate).toHaveBeenCalledWith("real prompt");
    expect(gateway.saveRoundState).toHaveBeenCalledTimes(1);
    expect(gateway.saveRoundState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: round.id,
        phase: "guessing",
        imageUrl: "https://example.com/image.png",
        prompts: {
          [round.activePlayer]: "real prompt",
        },
      }),
    );
    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "ImageGenerated",
      roundId: round.id,
      imageUrl: "https://example.com/image.png",
      guessingDurationMs: config.guessingDurationMs,
    });
    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "PhaseChanged",
      phase: "guessing",
      at: now,
    });
    expect(scheduler.scheduleTimeout).toHaveBeenCalledWith(
      round.id,
      "guessing",
      config.guessingDurationMs,
    );
  });

  it("throws when the round is not in the prompt phase", async () => {
    const context = createCommandContext();
    const { gateway, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "guessing",
      startedAt: now - 1000,
      seed: 42,
      prompts: { "p1": "real prompt" },
      imageUrl: "https://example.com/image.png",
    };

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);

    await expect(command.execute(context)).rejects.toThrow(/prompt phase/);
  });

  it("throws when the submitting player is not the active player", async () => {
    const context = createCommandContext();
    const { gateway, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      seed: 42,
      prompts: {},
    };

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitPrompt(round.id, "p2", "real prompt", now);

    await expect(command.execute(context)).rejects.toThrow(/active player/);
  });

  it("throws if the prompt was not persisted", async () => {
    const context = createCommandContext();
    const { gateway, bus, imageGenerator, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      seed: 42,
      prompts: {},
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: {} as Record<string, string>,
    });

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);

    await expect(command.execute(context)).rejects.toThrow(/persist/);
    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("is idempotent when the prompt has already been stored", async () => {
    const context = createCommandContext();
    const { gateway, bus, imageGenerator, config, scheduler } = context;
    const now = Date.now();
    const round: ValidRoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      seed: 42,
      prompts: {},
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: false,
      prompts: { [round.activePlayer]: "real prompt" },
    });

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);
    await command.execute(context);

    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });
});
