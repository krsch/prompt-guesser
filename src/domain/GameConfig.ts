export interface GameConfig {
  readonly totalRounds: number;
  readonly promptDurationMs: number;
  readonly guessingDurationMs: number;
  readonly votingDurationMs: number;
}

export type GameConfigOverrides = Partial<GameConfig>;

export function createGameConfig(overrides: GameConfigOverrides = {}): GameConfig {
  return {
    totalRounds: overrides.totalRounds ?? 3,
    promptDurationMs: overrides.promptDurationMs ?? 45_000,
    guessingDurationMs: overrides.guessingDurationMs ?? 60_000,
    votingDurationMs: overrides.votingDurationMs ?? 45_000,
  };
}
