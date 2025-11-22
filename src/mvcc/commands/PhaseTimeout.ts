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
    private readonly roundId: RoundId,
    private readonly phase: TimeoutPhase,
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

        const finishedRound = { ...round, scores, votes: {}, phase: "finished" as const };

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
