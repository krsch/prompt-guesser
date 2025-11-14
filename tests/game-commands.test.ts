import { describe, expect, it } from "vitest";

import { createCommandContext } from "./support/mocks.js";
import { CreateGame } from "../src/domain/commands/CreateGame.js";
import { JoinGame } from "../src/domain/commands/JoinGame.js";
import { GameCommandInputError } from "../src/domain/errors/GameCommandInputError.js";
import { createGameConfig } from "../src/domain/GameConfig.js";

describe("Game commands", () => {
  it("creates a new game and publishes the creation event", async () => {
    const context = createCommandContext();
    const { gameGateway, bus } = context;
    const config = createGameConfig({ totalRounds: 5 });

    gameGateway.createGame.mockResolvedValue({
      id: "game-1",
      players: ["host"],
      host: "host",
      currentRoundIndex: 0,
      cumulativeScores: { host: 0 },
      config,
      phase: "lobby",
    });

    const command = new CreateGame("host", config, Date.now());
    await command.execute(context);

    expect(gameGateway.createGame).toHaveBeenCalledWith("host", config);
    expect(bus.publish).toHaveBeenCalledWith(`game:game-1`, {
      type: "GameCreated",
      gameId: "game-1",
      host: "host",
      at: expect.any(Number),
      config,
    });
  });

  it("rejects invalid host identifiers", () => {
    const config = createGameConfig();
    expect(() => new CreateGame("", config, Date.now())).toThrow(GameCommandInputError);
  });

  it("allows players to join during the lobby phase", async () => {
    const context = createCommandContext();
    const { gameGateway, bus } = context;
    const gameState = {
      id: "game-1",
      players: ["host"],
      host: "host",
      currentRoundIndex: 0,
      cumulativeScores: { host: 0 },
      config: createGameConfig(),
      phase: "lobby" as const,
    };

    gameGateway.loadGameState.mockResolvedValue(gameState);

    const command = new JoinGame("game-1", "guest", Date.now());
    await command.execute(context);

    expect(gameGateway.saveGameState).toHaveBeenCalledWith(
      expect.objectContaining({
        players: ["host", "guest"],
        cumulativeScores: { host: 0, guest: 0 },
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith(`game:game-1`, {
      type: "PlayerJoined",
      gameId: "game-1",
      playerId: "guest",
      at: expect.any(Number),
      players: ["host", "guest"],
    });
  });

  it("prevents joining after the game becomes active", async () => {
    const context = createCommandContext();
    const { gameGateway } = context;
    const gameState = {
      id: "game-1",
      players: ["host"],
      host: "host",
      activeRoundId: "round-1",
      currentRoundIndex: 0,
      cumulativeScores: { host: 0 },
      config: createGameConfig(),
      phase: "active" as const,
    };

    gameGateway.loadGameState.mockResolvedValue(gameState);

    const command = new JoinGame("game-1", "guest", Date.now());
    await expect(command.execute(context)).rejects.toThrow(GameCommandInputError);
  });

  it("rejects invalid game configurations", () => {
    const invalidConfig = createGameConfig({ totalRounds: 0 });

    expect(() => new CreateGame("host", invalidConfig, Date.now())).toThrow(
      GameCommandInputError,
    );
  });
});
