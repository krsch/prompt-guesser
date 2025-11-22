import type { GameStore } from "./GameStore.js";
import type { GameReactor, GameReactorContext } from "./reactors.js";
import type { GameCommand, GameId } from "./types.js";
import { assertValidGameState } from "./validators.js";

export async function runGameCommand(
  gameId: GameId,
  cmd: GameCommand,
  store: GameStore,
  reactors: readonly GameReactor[],
  reactorCtx: GameReactorContext,
): Promise<Error | undefined> {
  const result = await store.updateGame(gameId, (state) => {
    assertValidGameState(state);
    const commandResult = cmd.apply(state);

    if (commandResult.kind === "ok" || commandResult.kind === "failedRound") {
      assertValidGameState(commandResult.state);
    }

    return commandResult;
  });

  if (result.kind === "rejected") {
    return result.error;
  }

  const { change } = result;
  const resultKind = result.kind;

  for (const reactor of reactors) {
    await reactor.handle(change, reactorCtx, resultKind);
  }
}
