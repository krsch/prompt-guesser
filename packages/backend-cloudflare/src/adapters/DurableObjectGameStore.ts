import type { DurableObjectState } from "@cloudflare/workers-types";

import { NotFoundError } from "../core.js";
import type { GameStore, GameStoreUpdateResult } from "../core.js";
import type { CommandResult, GameId, GameState } from "../core.js";

export class DurableObjectGameStore implements GameStore {
  readonly #state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.#state = state;
  }

  async loadGame(gameId: GameId): Promise<GameState> {
    const stored = (await this.#state.storage.get("game")) as GameState | undefined;
    if (!stored) {
      throw new NotFoundError(`Game ${gameId} not found`);
    }
    return structuredClone(stored);
  }

  async createGame(state: GameState): Promise<void> {
    await this.#state.storage.put("game", structuredClone(state));
  }

  async updateGame(
    gameId: GameId,
    applyFn: (state: GameState) => CommandResult,
  ): Promise<GameStoreUpdateResult> {
    const snapshot = await this.loadGame(gameId);
    const current = structuredClone(snapshot);
    const before = structuredClone(current);

    const result = applyFn(current);
    if (result.kind === "rejected") {
      return { kind: "rejected", error: result.error };
    }

    const after = result.state;
    await this.#state.storage.put("game", structuredClone(after));

    if (result.kind === "failedRound") {
      return { kind: "failedRound", change: { before, after }, error: result.error };
    }

    return { kind: "ok", change: { before, after } };
  }
}
