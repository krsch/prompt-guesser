import { CommandError } from "../errors.js";
import type { CommandResult, GameCommand, GameState, RoundId } from "../types.js";

export class SetRoundImage implements GameCommand {
  readonly type = "SetRoundImage";

  constructor(
    private readonly roundId: RoundId,
    private readonly imageUrl: string,
  ) {}

  apply(state: GameState): CommandResult {
    const currentRound = state.currentRound;
    if (!currentRound || currentRound.id !== this.roundId) {
      return { kind: "rejected", error: new CommandError("Round not active") };
    }

    const round = currentRound.state;
    if (round.phase !== "prompt") {
      return { kind: "rejected", error: new CommandError("Round already advanced") };
    }

    if (!round.prompts || round.prompts[round.activePlayer] === undefined) {
      return { kind: "rejected", error: new CommandError("Prompt not yet submitted") };
    }

    if (round.imageUrl) {
      if (round.imageUrl === this.imageUrl) {
        return { kind: "ok", state };
      }
      return { kind: "rejected", error: new CommandError("Image already set") };
    }

    const nextRound = {
      ...round,
      imageUrl: this.imageUrl,
      phase: "guessing" as const,
    };

    return {
      kind: "ok",
      state: { ...state, currentRound: { ...currentRound, state: nextRound } },
    };
  }
}
