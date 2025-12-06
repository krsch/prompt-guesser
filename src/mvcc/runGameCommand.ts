import { StateFailureError } from "./errors.js";
import type { GameStore } from "./GameStore.js";
import type { GameReactor, GameReactorContext } from "./reactors.js";
import type { GameCommand, GameId, GameState } from "./types.js";
import { assertValidGameState } from "./validators.js";

export async function runGameCommand(
  gameId: GameId,
  cmd: GameCommand,
  store: GameStore,
  reactors: readonly GameReactor[],
  reactorCtx: GameReactorContext,
): Promise<Error | undefined> {
  const result = await store.updateGame(gameId, (state) => {
    try {
      assertValidGameState(state);
      const commandResult = cmd.apply(state);

      if (commandResult.kind === "ok") {
        assertValidGameState(commandResult.state);
        return commandResult;
      }

      if (commandResult.kind === "failedRound") {
        return { ...commandResult, state: markRoundFailed(commandResult.state) };
      }

      return commandResult;
    } catch (error) {
      const failure =
        error instanceof StateFailureError
          ? error
          : new StateFailureError(
              (error as Error)?.message ?? "State validation failed",
              error,
            );
      return {
        kind: "failedRound",
        state: markRoundFailed(state),
        error: failure,
      };
    }
  });

  if (result.kind === "rejected") return result.error;

  const { change } = result;
  const resultKind = result.kind;

  for (const reactor of reactors) {
    await reactor.handle(change, reactorCtx, resultKind);
  }

  if (result.kind === "failedRound") {
    return result.error;
  }
}

function markRoundFailed(state: GameState): GameState {
  const current = state.currentRound;
  if (!current) return state;

  return {
    ...state,
    currentRound: {
      ...current,
      state: { ...current.state, phase: "failed" },
    },
  };
}
