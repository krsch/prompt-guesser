import { describe, it, expect, vi } from "vitest";

import { SubmitPrompt } from "../src/domain/commands/SubmitPrompt";
import type { RoundGateway, RoundState } from "../src/domain/ports/RoundGateway";
import type { MessageBus } from "../src/domain/ports/MessageBus";
import type { ImageGenerator } from "../src/domain/ports/ImageGenerator";
import { GameConfig } from "../src/domain/GameConfig";

const makeGateway = () =>
  ({
    loadRoundState: vi.fn(),
    appendPrompt: vi.fn(),
    saveRoundState: vi.fn(),
    scheduleTimeout: vi.fn(),
  }) satisfies Partial<RoundGateway>;

const makeBus = () =>
  ({
    publish: vi.fn(),
  }) satisfies Partial<MessageBus>;

const makeImageGenerator = () =>
  ({
    generate: vi.fn(),
  }) satisfies Partial<ImageGenerator>;

const makeConfig = () =>
  GameConfig.withDefaults();

describe("SubmitPrompt command", () => {
  it("stores the prompt, generates the image, advances the phase to guessing and publishes events", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const imageGenerator = makeImageGenerator();
    const config = makeConfig();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      promptDeadline: now + 1000,
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: { [round.activePlayer]: "real prompt" },
    });
    imageGenerator.generate.mockResolvedValue("https://example.com/image.png");

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: imageGenerator as ImageGenerator,
      config,
    });

    const guessingDeadline = now + config.guessingDurationMs;

    expect(gateway.loadRoundState).toHaveBeenCalledWith(round.id);
    expect(gateway.appendPrompt).toHaveBeenCalledWith(round.id, round.activePlayer, "real prompt");
    expect(imageGenerator.generate).toHaveBeenCalledWith("real prompt");
    expect(gateway.saveRoundState).toHaveBeenCalledTimes(1);
    expect(gateway.saveRoundState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: round.id,
        phase: "guessing",
        guessingDeadline,
        imageUrl: "https://example.com/image.png",
        prompts: {
          [round.activePlayer]: "real prompt",
        },
      }),
    );
    expect(gateway.scheduleTimeout).toHaveBeenCalledWith(round.id, "guessing", guessingDeadline);
    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "ImageGenerated",
      roundId: round.id,
      imageUrl: "https://example.com/image.png",
      guessingDeadline,
    });
    expect(bus.publish).toHaveBeenCalledWith(`round:${round.id}`, {
      type: "PhaseChanged",
      phase: "guessing",
      at: now,
    });
  });

  it("throws when the round is not in the prompt phase", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "guessing",
      startedAt: now - 1000,
    };

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: bus as MessageBus,
        imageGenerator: makeImageGenerator() as ImageGenerator,
        config,
      }),
    ).rejects.toThrow(/prompt phase/);
  });

  it("throws when the submitting player is not the active player", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
    };

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitPrompt(round.id, "p2", "real prompt", now);

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: bus as MessageBus,
        imageGenerator: makeImageGenerator() as ImageGenerator,
        config,
      }),
    ).rejects.toThrow(/active player/);
  });

  it("throws if the prompt was not persisted", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const imageGenerator = makeImageGenerator();
    const config = makeConfig();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: true,
      prompts: {},
    });

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: bus as MessageBus,
        imageGenerator: imageGenerator as ImageGenerator,
        config,
      }),
    ).rejects.toThrow(/persist/);
    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("throws if the prompt is submitted after the deadline", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const imageGenerator = makeImageGenerator();
    const config = makeConfig();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 10_000,
      promptDeadline: now,
    };

    gateway.loadRoundState.mockResolvedValue(round);

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);

    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: bus as MessageBus,
        imageGenerator: imageGenerator as ImageGenerator,
        config,
      }),
    ).rejects.toThrow(/deadline/);
    expect(gateway.appendPrompt).not.toHaveBeenCalled();
    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("is idempotent when the prompt has already been stored", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const imageGenerator = makeImageGenerator();
    const config = makeConfig();
    const now = Date.now();
    const round: RoundState = {
      id: "round-123",
      players: ["p1", "p2", "p3", "p4"],
      activePlayer: "p1",
      phase: "prompt",
      startedAt: now - 1000,
      promptDeadline: now + 1000,
    };

    gateway.loadRoundState.mockResolvedValue(round);
    gateway.appendPrompt.mockResolvedValue({
      inserted: false,
      prompts: { [round.activePlayer]: "real prompt" },
    });

    const command = new SubmitPrompt(round.id, round.activePlayer, "real prompt", now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      imageGenerator: imageGenerator as ImageGenerator,
      config,
    });

    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });
});
