import { describe, expect, it, vi } from "vitest";

import { createGameConfig } from "../src/domain/GameConfig.js";
import type { ImageGenerator } from "../src/domain/ports/ImageGenerator.js";
import { SetRoundImage } from "../src/mvcc/commands/SetRoundImage.js";
import { ImageGenerationReactor } from "../src/mvcc/reactors/ImageGenerationReactor.js";
import type { GameReactorContext } from "../src/mvcc/reactors.js";
import type { GameState, RoundState } from "../src/mvcc/types.js";

describe("ImageGenerationReactor", () => {
  it("generates an image only when a prompt is newly added and no image exists", async () => {
    const imageGenerator = makeGenerator();
    const reactor = new ImageGenerationReactor(imageGenerator);

    const before = makeGameState({ prompts: {}, imageUrl: undefined });
    const after = makeGameState({ prompts: { p1: "prompt" }, imageUrl: undefined });

    const ctx = makeCtx();

    await reactor.handle({ before, after }, ctx, "ok");

    expect(imageGenerator.generate).toHaveBeenCalledWith("prompt");
    expect(ctx.service.run).toHaveBeenCalledWith("game-1", expect.any(SetRoundImage));
  });

  it("skips when image already exists", async () => {
    const imageGenerator = makeGenerator();
    const reactor = new ImageGenerationReactor(imageGenerator);

    const before = makeGameState({ prompts: { p1: "prompt" }, imageUrl: "existing" });
    const after = makeGameState({ prompts: { p1: "prompt" }, imageUrl: "existing" });
    const ctx = makeCtx();

    await reactor.handle({ before, after }, ctx, "ok");

    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(ctx.service.run).not.toHaveBeenCalled();
  });

  it("skips when prompt was already present before", async () => {
    const imageGenerator = makeGenerator();
    const reactor = new ImageGenerationReactor(imageGenerator);

    const before = makeGameState({ prompts: { p1: "prompt" }, imageUrl: undefined });
    const after = makeGameState({ prompts: { p1: "prompt" }, imageUrl: undefined });
    const ctx = makeCtx();

    await reactor.handle({ before, after }, ctx, "ok");

    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(ctx.service.run).not.toHaveBeenCalled();
  });
});

function makeCtx(): GameReactorContext {
  return {
    bus: { publish: vi.fn(async () => {}) },
    scheduler: { scheduleTimeout: vi.fn(async () => {}) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    service: { run: vi.fn(async () => {}) },
  };
}

function makeGameState({
  prompts,
  imageUrl,
}: {
  prompts: Record<string, string> | undefined;
  imageUrl: string | undefined;
}): GameState {
  const config = createGameConfig();
  const roundState: RoundState = {
    id: "round-1",
    players: ["p1", "p2"],
    activePlayer: "p1",
    phase: "prompt",
    seed: 1,
    startedAt: 1,
    ...(prompts !== undefined ? { prompts } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
  };

  return {
    id: "game-1",
    lobby: { host: "p1", players: ["p1"], config },
    currentRound: {
      id: "round-1",
      state: roundState,
    },
  };
}

function makeGenerator(): ImageGenerator {
  return {
    generate: vi.fn(async (prompt: string): Promise<string> => `https://img/${prompt}`),
  };
}
