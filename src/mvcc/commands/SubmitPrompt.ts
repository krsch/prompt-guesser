import { CommandError } from "../errors.js";
import type {
  CommandResult,
  GameCommand,
  GameState,
  PlayerId,
  RoundId,
} from "../types.js";

export class SubmitPrompt implements GameCommand {
  readonly type = "SubmitPrompt";

  constructor(
    private readonly roundId: RoundId,
    private readonly playerId: PlayerId,
    private readonly prompt: string,
  ) {}

  apply(state: GameState): CommandResult {
    const currentRound = state.currentRound;
    if (!currentRound || currentRound.id !== this.roundId) {
      return { kind: "rejected", error: new CommandError("Round not active") };
    }

    const round = currentRound.state;

    if (round.phase !== "prompt") {
      return {
        kind: "rejected",
        error: new CommandError("Cannot submit prompt outside prompt phase"),
      };
    }

    if (round.activePlayer !== this.playerId) {
      return {
        kind: "rejected",
        error: new CommandError("Only active player may submit the prompt"),
      };
    }

    const prompts = round.prompts ?? {};
    const existing = prompts[this.playerId];
    if (existing !== undefined) {
      if (existing !== this.prompt) {
        return {
          kind: "rejected",
          error: new CommandError("Prompt already submitted with different content"),
        };
      }
      return { kind: "ok", state };
    }

    const nextRound = {
      ...round,
      prompts: { ...prompts, [this.playerId]: this.prompt },
    };

    const nextState: GameState = {
      ...state,
      currentRound: { ...currentRound, state: nextRound },
    };

    return { kind: "ok", state: nextState };
  }
}
