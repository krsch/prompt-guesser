import type { GameStateChange } from "../GameStore.js";
import type { GameReactor, GameReactorContext } from "../reactors.js";

export class PhaseSchedulerReactor implements GameReactor {
  async handle(
    change: GameStateChange,
    ctx: GameReactorContext,
    _resultKind: "ok" | "failedRound",
  ): Promise<void> {
    const before = change.before.currentRound?.state;
    const after = change.after.currentRound?.state;

    if (!after) return;

    if (after.phase === "prompt") {
      const sameRoundAsBefore = before?.id === after.id;
      if (sameRoundAsBefore && before?.phase === "prompt") return;

      await ctx.scheduler.scheduleTimeout(
        after.id,
        "prompt",
        change.after.lobby.config.promptDurationMs,
        change.after.id,
      );
      return;
    }

    if (!before || before.phase === after.phase) return;

    if (after.phase === "guessing") {
      await ctx.scheduler.scheduleTimeout(
        after.id,
        "guessing",
        change.after.lobby.config.guessingDurationMs,
        change.after.id,
      );
    }

    if (after.phase === "voting") {
      await ctx.scheduler.scheduleTimeout(
        after.id,
        "voting",
        change.after.lobby.config.votingDurationMs,
        change.after.id,
      );
    }
  }
}
