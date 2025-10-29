import { GameCommandInputError } from "../errors/GameCommandInputError.js";
import type { GameId } from "../ports/GameGateway.js";
import type { PlayerId, TimePoint } from "../typedefs.js";
import { Command, type CommandContext } from "./Command.js";

const WHITESPACE_PATTERN = /\s/;

export class JoinGame extends Command {
  readonly type = "JoinGame" as const;

  constructor(
    public readonly gameId: GameId,
    public readonly playerId: PlayerId,
    public readonly at: TimePoint,
  ) {
    super();

    if (!JoinGame.isValidPlayerId(playerId)) {
      throw GameCommandInputError.because([
        "Player identifier must be a non-empty string without whitespace",
      ]);
    }
  }

  async execute(ctx: CommandContext): Promise<void> {
    const { gameGateway, bus, logger } = ctx;

    const game = await gameGateway.loadGameState(this.gameId);

    if (game.phase !== "lobby") {
      throw GameCommandInputError.because([
        "Cannot join a game that has already started",
      ]);
    }

    if (game.players.includes(this.playerId)) {
      logger?.info?.("Join ignored; player already part of the game", {
        type: this.type,
        gameId: this.gameId,
        playerId: this.playerId,
        at: this.at,
      });
      return;
    }

    game.players.push(this.playerId);
    game.cumulativeScores[this.playerId] = 0;

    await gameGateway.saveGameState(game);

    logger?.info?.("Player joined game", {
      type: this.type,
      gameId: this.gameId,
      playerId: this.playerId,
      at: this.at,
    });

    await bus.publish(`game:${this.gameId}`, {
      type: "PlayerJoined",
      gameId: this.gameId,
      playerId: this.playerId,
      at: this.at,
      players: [...game.players],
    });
  }

  private static isValidPlayerId(id: unknown): id is PlayerId {
    return typeof id === "string" && id.length > 0 && !WHITESPACE_PATTERN.test(id);
  }
}
