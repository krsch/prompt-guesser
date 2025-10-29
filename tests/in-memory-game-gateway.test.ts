import { describe, expect, it } from "vitest";

import { InMemoryGameGateway } from "../src/adapters/in-memory/InMemoryGameGateway.js";
import { createGameConfig } from "../src/domain/GameConfig.js";

describe("InMemoryGameGateway", () => {
  it("creates and loads a new game", async () => {
    const gateway = new InMemoryGameGateway();
    const config = createGameConfig({ totalRounds: 2 });

    const game = await gateway.createGame("host", config);
    expect(game).toMatchObject({
      id: expect.stringMatching(/^game-/),
      players: ["host"],
      host: "host",
      currentRoundIndex: 0,
      phase: "lobby",
      cumulativeScores: { host: 0 },
      config,
    });

    const loaded = await gateway.loadGameState(game.id);
    expect(loaded).toEqual(game);
  });

  it("persists updates to the game state", async () => {
    const gateway = new InMemoryGameGateway();
    const config = createGameConfig();
    const game = await gateway.createGame("host", config);

    game.players.push("guest");
    game.cumulativeScores.guest = 0;
    game.phase = "active";

    await gateway.saveGameState(game);

    const loaded = await gateway.loadGameState(game.id);
    expect(loaded).toEqual(game);
  });

  it("throws when accessing unknown games", async () => {
    const gateway = new InMemoryGameGateway();
    const config = createGameConfig();
    const game = await gateway.createGame("host", config);

    await expect(gateway.loadGameState("missing" as never)).rejects.toThrow();
    await expect(gateway.saveGameState({ ...game, id: "missing" as never })).rejects.toThrow();
  });
});
