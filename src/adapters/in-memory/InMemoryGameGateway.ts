/* eslint-disable functional/immutable-data */
/* eslint-disable functional/prefer-readonly-type */
import type {
  GameGateway,
  GameId,
  GameState,
} from "../../domain/ports/GameGateway.js";
import type { GameConfig } from "../../domain/GameConfig.js";
import type { PlayerId } from "../../domain/typedefs.js";

export class InMemoryGameGateway implements GameGateway {
  #games = new Map<GameId, GameState>();
  #nextId = 1;

  async loadGameState(gameId: GameId): Promise<GameState> {
    const state = this.#games.get(gameId);
    if (!state) {
      throw new Error(`Game ${gameId} not found`);
    }
    return this.#clone(state);
  }

  async saveGameState(state: GameState): Promise<void> {
    if (!this.#games.has(state.id)) {
      throw new Error(`Game ${state.id} not found`);
    }
    this.#games.set(state.id, this.#clone(state));
  }

  async createGame(host: PlayerId, config: GameConfig): Promise<GameState> {
    const id = `game-${this.#nextId++}` as GameId;
    const state: GameState = {
      id,
      players: [host],
      host,
      activeRoundId: undefined,
      currentRoundIndex: 0,
      cumulativeScores: { [host]: 0 },
      config: { ...config },
      phase: "lobby",
    };
    this.#games.set(id, this.#clone(state));
    return this.#clone(state);
  }

  #clone(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
  }
}
