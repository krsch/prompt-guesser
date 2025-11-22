import type { CommandError, StateFailureError } from "./errors.js";
import type { GameConfig } from "../domain/GameConfig.js";

export type GameId = string;
export type RoundId = string;
export type PlayerId = string;
export type TimePoint = number;

export type RoundPhase =
  | "prompt"
  | "guessing"
  | "voting"
  | "scoring"
  | "finished"
  | "failed";

export interface LobbyState {
  readonly host: PlayerId;
  readonly players: readonly PlayerId[];
  readonly config: GameConfig;
}

export interface RoundState {
  readonly id: RoundId;
  readonly players: readonly PlayerId[];
  readonly activePlayer: PlayerId;
  readonly phase: RoundPhase;
  readonly seed: number;
  readonly startedAt: TimePoint;
  readonly imageUrl?: string;
  readonly prompts?: Record<PlayerId, string>;
  readonly votes?: Record<PlayerId, number>;
  readonly scores?: Record<PlayerId, number>;
  readonly shuffleOrder?: readonly number[];
}

export interface GameState {
  readonly id: GameId;
  readonly lobby: LobbyState;
  readonly currentRound?: {
    readonly id: RoundId;
    readonly state: RoundState;
  };
}

export type CommandResult =
  | { readonly kind: "ok"; readonly state: GameState }
  | { readonly kind: "rejected"; readonly error: CommandError }
  | {
      readonly kind: "failedRound";
      readonly state: GameState;
      readonly error: StateFailureError;
    };

export interface GameCommand {
  readonly type: string;
  apply(state: GameState): CommandResult;
}
