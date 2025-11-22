import type { CommandError, StateFailureError } from "./errors.js";
import type { CommandResult, GameId, GameState } from "./types.js";

export interface GameStateChange {
  readonly before: GameState;
  readonly after: GameState;
}

export type GameStoreUpdateResult =
  | { readonly kind: "ok"; readonly change: GameStateChange }
  | {
      readonly kind: "failedRound";
      readonly change: GameStateChange;
      readonly error: StateFailureError;
    }
  | { readonly kind: "rejected"; readonly error: CommandError };

export interface GameStore {
  createGame(state: GameState): Promise<void>;
  updateGame(
    gameId: GameId,
    applyFn: (state: GameState) => CommandResult,
  ): Promise<GameStoreUpdateResult>;
}
