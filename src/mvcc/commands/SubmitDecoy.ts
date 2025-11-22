import { CommandError } from "../errors.js";
import { generateShuffle } from "../rules.js";
import type {
  CommandResult,
  GameCommand,
  GameState,
  PlayerId,
  RoundId,
  RoundState,
} from "../types.js";

export class SubmitDecoy implements GameCommand {
  readonly type = "SubmitDecoy";

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

    if (round.phase !== "guessing") {
      return {
        kind: "rejected",
        error: new CommandError("Cannot submit decoy outside guessing phase"),
      };
    }

    if (!round.players.includes(this.playerId)) {
      return { kind: "rejected", error: new CommandError("Player not in round") };
    }

    if (round.activePlayer === this.playerId) {
      return {
        kind: "rejected",
        error: new CommandError("Active player cannot submit decoy"),
      };
    }

    const prompts = round.prompts ?? {};
    const existing = prompts[this.playerId];
    if (existing !== undefined) {
      if (existing === this.prompt) return { kind: "ok", state };
      return {
        kind: "rejected",
        error: new CommandError("Prompt already submitted with different content"),
      };
    }

    const withPrompt: RoundState = {
      ...round,
      prompts: { ...prompts, [this.playerId]: this.prompt },
    };

    const totalSubmitted = Object.keys(withPrompt.prompts ?? {}).length;
    const needsVoting = totalSubmitted >= withPrompt.players.length;

    const nextRound: RoundState = needsVoting
      ? {
          ...withPrompt,
          phase: "voting",
          shuffleOrder: generateShuffle(withPrompt),
          votes: {},
        }
      : withPrompt;

    const nextState: GameState = {
      ...state,
      currentRound: { ...currentRound, state: nextRound },
    };

    return { kind: "ok", state: nextState };
  }
}
