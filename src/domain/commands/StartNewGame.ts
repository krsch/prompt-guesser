import { Command, type CommandContext } from "./Command.js";
import { StartNewGameInputError } from "../errors/StartNewGameInputError.js";
import type { PlayerId, TimePoint } from "../typedefs.js";

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 6;
const WHITESPACE_PATTERN = /\s/;

export class StartNewGame extends Command {
  readonly type = "StartNewGame" as const;

  constructor(
    public readonly players: readonly PlayerId[],
    public readonly activePlayer: PlayerId,
    public readonly at: TimePoint,
  ) {
    super();

    const issues = StartNewGame.validateInput(players, activePlayer);
    if (issues.length > 0) {
      throw StartNewGameInputError.because(issues);
    }
  }

  async execute({ gateway, bus }: CommandContext): Promise<void> {
    const round = await gateway.startNewRound([...this.players], this.activePlayer);

    await bus.publish(`round:${round.id}`, {
      type: "RoundStarted",
      round,
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
