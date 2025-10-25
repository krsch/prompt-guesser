export interface GameConfigOptions {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly promptDurationMs: number;
  readonly guessingDurationMs: number;
  readonly votingDurationMs: number;
}

export class GameConfig {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly promptDurationMs: number;
  readonly guessingDurationMs: number;
  readonly votingDurationMs: number;

  constructor(options: GameConfigOptions) {
    this.minPlayers = options.minPlayers;
    this.maxPlayers = options.maxPlayers;
    this.promptDurationMs = options.promptDurationMs;
    this.guessingDurationMs = options.guessingDurationMs;
    this.votingDurationMs = options.votingDurationMs;
  }

  static withDefaults(): GameConfig {
    return new GameConfig({
      minPlayers: 4,
      maxPlayers: 6,
      promptDurationMs: 45_000,
      guessingDurationMs: 60_000,
      votingDurationMs: 45_000,
    });
  }
}
