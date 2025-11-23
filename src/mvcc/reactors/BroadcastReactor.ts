import type { GameStateChange } from "../GameStore.js";
import type { GameReactor, GameReactorContext } from "../reactors.js";
import { projectVisibleState } from "../visibility.js";

export class BroadcastReactor implements GameReactor {
  async handle(
    change: GameStateChange,
    ctx: GameReactorContext,
    _resultKind: "ok" | "failedRound",
  ): Promise<void> {
    const visibleAfter = projectVisibleState(change.after);
    const visibleBefore = projectVisibleState(change.before);

    if (JSON.stringify(visibleAfter) === JSON.stringify(visibleBefore)) {
      return;
    }

    await ctx.bus.publish(`game:${visibleAfter.id}`, {
      type: "GameStateUpdated",
      gameId: visibleAfter.id,
      state: visibleAfter,
    });
  }
}
