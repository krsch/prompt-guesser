/* eslint-disable functional/immutable-data */
/* eslint-disable functional/prefer-readonly-type */

import { NotFoundError } from "../../mvcc/errors.js";
import type { GameStore, GameStoreUpdateResult } from "../../mvcc/GameStore.js";
import type { CommandResult, GameId, GameState } from "../../mvcc/types.js";

export class InMemoryGameStore implements GameStore {
  #games = new Map<GameId, GameState>();

  async loadGame(gameId: GameId): Promise<GameState> {
    return this.#clone(this.#load(gameId));
  }

  async createGame(state: GameState): Promise<void> {
    this.#games.set(state.id, this.#clone(state));
  }

  async updateGame(
    gameId: GameId,
    applyFn: (state: GameState) => CommandResult,
  ): Promise<GameStoreUpdateResult> {
    const snapshot = this.#load(gameId);

    const current = this.#clone(snapshot);
    const before = this.#clone(current);

    const result = applyFn(current);

    if (result.kind === "rejected") {
      return { kind: "rejected", error: result.error };
    }

    const after = result.state;
    this.#games.set(gameId, this.#clone(after));

    if (result.kind === "failedRound") {
      return {
        kind: "failedRound",
        change: { before, after },
        error: result.error,
      };
    }

    return { kind: "ok", change: { before, after } };
  }

  #load(gameId: GameId): GameState {
    const existing = this.#games.get(gameId);
    if (!existing) {
      throw new NotFoundError(`Game ${gameId} not found`);
    }
    return existing;
  }

  #clone(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
  }
}
