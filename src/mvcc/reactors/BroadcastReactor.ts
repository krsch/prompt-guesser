import type { GameStateChange } from "../GameStore.js";
import type { GameReactor, GameReactorContext } from "../reactors.js";
import { projectVisibleState } from "../visibility.js";

export class BroadcastReactor implements GameReactor {
  async handle(
    change: GameStateChange,
    ctx: GameReactorContext,
    _resultKind: "ok" | "failedRound",
  ): Promise<void> {
    const visible = projectVisibleState(change.after);
    await ctx.bus.publish(`game:${visible.id}`, {
      type: "GameStateUpdated",
      gameId: visible.id,
      state: visible,
    });
  }
}
