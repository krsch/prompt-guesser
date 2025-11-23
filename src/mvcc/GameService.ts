import type { GameStore } from "./GameStore.js";
import type {
  GameReactor,
  GameReactorContext,
  GameReactorContextBase,
} from "./reactors.js";
import { runGameCommand } from "./runGameCommand.js";
import type { GameCommand, GameId, GameState } from "./types.js";

export interface GameServiceOptions {
  readonly store: GameStore;
  readonly reactors?: readonly GameReactor[];
  readonly reactorContext: GameReactorContextBase;
}

export class GameService {
  readonly #store: GameStore;
  readonly #reactors: readonly GameReactor[];
  readonly #reactorContext: GameReactorContext;

  constructor(options: GameServiceOptions) {
    this.#store = options.store;
    this.#reactors = options.reactors ?? [];
    this.#reactorContext = {
      ...options.reactorContext,
      service: {
        run: (gameId: GameId, command: GameCommand): Promise<void> =>
          this.run(gameId, command),
      },
    };
  }

  async createGame(state: GameState): Promise<void> {
    await this.#store.createGame(state);
  }

  async run(gameId: GameId, command: GameCommand): Promise<void> {
    const error = await runGameCommand(
      gameId,
      command,
      this.#store,
      this.#reactors,
      this.#reactorContext,
    );

    if (error) {
      throw error;
    }
  }
}
