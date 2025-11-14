/* eslint-disable functional/immutable-data */
import { StartNextRoundInputError } from "../errors/StartNextRoundInputError.js";
import type { GameId, GameState } from "../ports/GameGateway.js";
import type { PlayerId, TimePoint } from "../typedefs.js";
import { Command, type CommandContext } from "./Command.js";

export class StartNextRound extends Command {
  readonly type = "StartNextRound" as const;

  constructor(
    public readonly gameId: GameId,
    public readonly at: TimePoint,
  ) {
    super();
  }

  async execute(ctx: CommandContext): Promise<void> {
    const { gameGateway, roundGateway, scheduler, bus, logger } = ctx;

    const game = await gameGateway.loadGameState(this.gameId);

    const issues = StartNextRound.validateGame(game);
    if (issues.length > 0) {
      throw StartNextRoundInputError.because(issues);
    }

    const activePlayer = StartNextRound.resolveActivePlayer(
      game.players,
      game.currentRoundIndex,
    );

    const round = await roundGateway.startNewRound(
      game.id,
      [...game.players],
      activePlayer,
      this.at,
    );

    game.activeRoundId = round.id;
    game.phase = "active";

    await gameGateway.saveGameState(game);

    await scheduler.scheduleTimeout(round.id, "prompt", game.config.promptDurationMs);

    logger?.info?.("Round started", {
      type: this.type,
      gameId: game.id,
      roundId: round.id,
      at: this.at,
    });

    await bus.publish(`round:${round.id}`, {
      type: "RoundStarted",
      gameId: game.id,
      roundId: round.id,
      players: [...round.players],
      activePlayer: round.activePlayer,
      at: this.at,
      promptDurationMs: game.config.promptDurationMs,
    });
  }

  private static validateGame(game: GameState): readonly string[] {
    const issues: string[] = [];

    if (game.phase === "finished") {
      issues.push("Cannot start a round for a finished game");
    }

    if (game.players.length < 3) {
      issues.push("Game must have at least 3 players to start a round");
    }

    if (game.activeRoundId) {
      issues.push("Game already has an active round");
    }

    return issues;
  }

  private static resolveActivePlayer(
    players: readonly PlayerId[],
    roundIndex: number,
  ): PlayerId {
    const index = roundIndex % players.length;
    const player = players[index];

    if (player === undefined) {
      throw StartNextRoundInputError.because(["Game has no eligible active player"]);
    }

    return player;
  }
}
