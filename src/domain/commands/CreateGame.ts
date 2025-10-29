import { GameCommandInputError } from "../errors/GameCommandInputError.js";
import type { GameConfig } from "../GameConfig.js";
import type { PlayerId, TimePoint } from "../typedefs.js";
import { Command, type CommandContext } from "./Command.js";

const WHITESPACE_PATTERN = /\s/;

export class CreateGame extends Command {
  readonly type = "CreateGame" as const;

  constructor(
    public readonly host: PlayerId,
    public readonly config: GameConfig,
    public readonly at: TimePoint,
  ) {
    super();

    if (!CreateGame.isValidPlayerId(host)) {
      throw GameCommandInputError.because([
        "Host must be a non-empty string without whitespace",
      ]);
    }

    const issues = CreateGame.validateConfig(config);
    if (issues.length > 0) {
      throw GameCommandInputError.because(issues);
    }
  }

  async execute(ctx: CommandContext): Promise<void> {
    const { gameGateway, bus, logger } = ctx;

    const game = await gameGateway.createGame(this.host, this.config);

    logger?.info?.("Game created", {
      type: this.type,
      gameId: game.id,
      host: this.host,
      at: this.at,
    });

    await bus.publish(`game:${game.id}`, {
      type: "GameCreated",
      gameId: game.id,
      host: this.host,
      at: this.at,
      config: this.config,
    });
  }

  private static isValidPlayerId(id: unknown): id is PlayerId {
    return typeof id === "string" && id.length > 0 && !WHITESPACE_PATTERN.test(id);
  }

  private static validateConfig(config: GameConfig): readonly string[] {
    const issues: string[] = [];

    if (!Number.isInteger(config.totalRounds) || config.totalRounds < 1) {
      issues.push("totalRounds must be an integer greater than or equal to 1");
    }

    if (!CreateGame.isPositiveDuration(config.promptDurationMs)) {
      issues.push("promptDurationMs must be greater than 0");
    }

    if (!CreateGame.isPositiveDuration(config.guessingDurationMs)) {
      issues.push("guessingDurationMs must be greater than 0");
    }

    if (!CreateGame.isPositiveDuration(config.votingDurationMs)) {
      issues.push("votingDurationMs must be greater than 0");
    }

    return issues;
  }

  private static isPositiveDuration(value: number): boolean {
    return Number.isFinite(value) && value > 0;
  }
}
