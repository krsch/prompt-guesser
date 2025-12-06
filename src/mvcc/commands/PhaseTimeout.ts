import { CommandError } from "../errors.js";
import { generateShuffle } from "../rules.js";
import { computeVoteScores } from "../scoring.js";
import type {
  CommandResult,
  GameCommand,
  GameState,
  PlayerId,
  RoundId,
  RoundState,
} from "../types.js";

type TimeoutPhase = "prompt" | "guessing" | "voting";

export class PhaseTimeout implements GameCommand {
  readonly type = "PhaseTimeout";

  constructor(
    public readonly roundId: RoundId,
    public readonly phase: TimeoutPhase,
  ) {}

  apply(state: GameState): CommandResult {
    const currentRound = state.currentRound;
    if (!currentRound || currentRound.id !== this.roundId) {
      return { kind: "rejected", error: new CommandError("Round not active") };
    }

    const round = currentRound.state;
    if (round.phase !== this.phase) {
      return { kind: "rejected", error: new CommandError("Phase already advanced") };
    }

    switch (this.phase) {
      case "prompt": {
        const scores = Object.fromEntries(
          round.players.map((playerId) => [playerId, 0] as const),
        ) as Record<PlayerId, number>;

        const timeoutPrompt =
          round.prompts?.[round.activePlayer] ?? ("[prompt timed out]" as const);
        const prompts = {
          ...round.prompts,
          [round.activePlayer]: timeoutPrompt,
        };
        const imageUrl =
          round.imageUrl ??
          "https://dummyimage.com/1024x1024/111827/ffffff&text=prompt+timed+out";

        const finishedRound = {
          ...round,
          prompts,
          imageUrl,
          scores,
          votes: {},
          phase: "finished" as const,
        };

        return {
          kind: "ok",
          state: { ...state, currentRound: { ...currentRound, state: finishedRound } },
        };
      }

      case "guessing": {
        const nextRound = {
          ...round,
          phase: "voting" as const,
          shuffleOrder: generateShuffle(round),
          votes: {},
        };
        return {
          kind: "ok",
          state: { ...state, currentRound: { ...currentRound, state: nextRound } },
        };
      }

      case "voting": {
        const finishedRound = this.#finalizeWithVotes(round, round.votes ?? {});

        return {
          kind: "ok",
          state: { ...state, currentRound: { ...currentRound, state: finishedRound } },
        };
      }
    }
  }

  #finalizeWithVotes(round: RoundState, votes: Record<PlayerId, number>): RoundState {
    const scores = computeVoteScores(round, votes);

    return {
      ...round,
      votes,
      scores,
      phase: "finished" as const,
    };
  }
}
