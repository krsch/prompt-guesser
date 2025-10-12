import { Command, type CommandContext } from "./Command.js";
import { StartNewRoundInputError } from "../errors/StartNewRoundInputError.js";
import type { PlayerId, TimePoint } from "../typedefs.js";

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 6;
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

    const issues = StartNewRound.validateInput(players, activePlayer);
    if (issues.length > 0) {
      throw StartNewRoundInputError.because(issues);
    }
  }

  async execute({ gateway, bus, logger }: CommandContext): Promise<void> {
    const round = await gateway.startNewRound([...this.players], this.activePlayer);

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
    });
  }

  private static validateInput(
    players: readonly PlayerId[],
    activePlayer: PlayerId,
  ): string[] {
    const issues: string[] = [];

    if (!Array.isArray(players) || players.length === 0) {
      issues.push(this.rangeMessage());
      return issues;
    }

    if (players.some((player) => !this.isValidPlayerId(player))) {
      issues.push("Players must be non-empty strings without whitespace");
    }

    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      issues.push(this.rangeMessage());
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

  private static isValidPlayerId(id: unknown): id is PlayerId {
    return typeof id === "string" && id.length > 0 && !WHITESPACE_PATTERN.test(id);
  }

  private static rangeMessage(): string {
    return `Players list must contain between ${MIN_PLAYERS} and ${MAX_PLAYERS} players`;
  }
}
