import { Command, type CommandContext } from "./Command.js";
import { StartNewRoundInputError } from "../errors/StartNewRoundInputError.js";
import type { PlayerId, TimePoint } from "../typedefs.js";
const WHITESPACE_PATTERN = /\s/;

/**
 * Validation happens in the constructor to fail fast and guarantee invariants
 * for all instances.
 */
export class StartNewRound extends Command {
  readonly type = "StartNewRound" as const;

  constructor(
    public readonly players: readonly PlayerId[],
    public readonly activePlayer: PlayerId,
    public readonly at: TimePoint,
  ) {
    super();

    const issues = StartNewRound.validateStaticInvariants(players, activePlayer);
    if (issues.length > 0) {
      throw StartNewRoundInputError.because(issues);
    }
  }

  async execute({
    gateway,
    bus,
    logger,
    config,
    scheduler,
  }: CommandContext): Promise<void> {
    const issues = StartNewRound.validateAgainstConfig(this.players, config);
    if (issues.length > 0) {
      throw StartNewRoundInputError.because(issues);
    }

    const round = await gateway.startNewRound(
      [...this.players],
      this.activePlayer,
      this.at,
    );

    await scheduler.scheduleTimeout(round.id, "prompt", config.promptDurationMs);

    logger?.info?.("Round started", {
      type: this.type,
      roundId: round.id,
      at: this.at,
    });

    await bus.publish(`round:${round.id}`, {
      type: "RoundStarted",
      roundId: round.id,
      players: [...round.players],
      activePlayer: round.activePlayer,
      at: this.at,
      promptDurationMs: config.promptDurationMs,
    });
  }

  private static validateStaticInvariants(
    players: readonly PlayerId[],
    activePlayer: PlayerId,
  ): string[] {
    const issues: string[] = [];

    if (!Array.isArray(players) || players.length === 0) {
      issues.push("Players list must contain at least one player");
      return issues;
    }

    if (players.some((player) => !this.isValidPlayerId(player))) {
      issues.push("Players must be non-empty strings without whitespace");
    }

    const uniquePlayers = new Set(players);
    if (uniquePlayers.size !== players.length) {
      issues.push("Players must be unique");
    }

    if (!this.isValidPlayerId(activePlayer)) {
      issues.push("Active player must be a non-empty string without whitespace");
    } else if (!uniquePlayers.has(activePlayer)) {
      issues.push("Active player must be included in the players list");
    }

    return issues;
  }

  private static validateAgainstConfig(
    players: readonly PlayerId[],
    config: CommandContext["config"],
  ): string[] {
    if (players.length < config.minPlayers || players.length > config.maxPlayers) {
      return [
        `Players list must contain between ${config.minPlayers} and ${config.maxPlayers} players`,
      ];
    }

    return [];
  }

  private static isValidPlayerId(id: unknown): id is PlayerId {
    return typeof id === "string" && id.length > 0 && !WHITESPACE_PATTERN.test(id);
  }
}
