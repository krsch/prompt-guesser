import { CommandError, StateFailureError } from "../errors.js";
import { computeVoteScores } from "../scoring.js";
import type {
  CommandResult,
  GameCommand,
  GameState,
  PlayerId,
  RoundId,
  RoundState,
} from "../types.js";

export class SubmitVote implements GameCommand {
  readonly type = "SubmitVote";

  constructor(
    private readonly roundId: RoundId,
    private readonly playerId: PlayerId,
    private readonly promptIndex: number,
  ) {}

  apply(state: GameState): CommandResult {
    const currentRound = state.currentRound;
    if (!currentRound || currentRound.id !== this.roundId) {
      return { kind: "rejected", error: new CommandError("Round not active") };
    }

    const round = currentRound.state;

    if (round.phase !== "voting") {
      return { kind: "rejected", error: new CommandError("Not in voting phase") };
    }

    if (!round.shuffleOrder || round.shuffleOrder.length === 0) {
      return {
        kind: "failedRound",
        state,
        error: new StateFailureError("Shuffle order missing in voting phase"),
      };
    }

    if (!round.players.includes(this.playerId)) {
      return { kind: "rejected", error: new CommandError("Player not in round") };
    }

    if (round.activePlayer === this.playerId) {
      return { kind: "rejected", error: new CommandError("Active player cannot vote") };
    }

    if (this.promptIndex < 0 || this.promptIndex >= round.shuffleOrder.length) {
      return { kind: "rejected", error: new CommandError("Invalid vote index") };
    }

    const votes = round.votes ?? {};
    const existing = votes[this.playerId];
    if (existing !== undefined) {
      if (existing === this.promptIndex) return { kind: "ok", state };
      return {
        kind: "rejected",
        error: new CommandError("Vote already submitted with different value"),
      };
    }

    const updatedVotes = { ...votes, [this.playerId]: this.promptIndex };
    const eligibleVoters = round.players.length - 1;

    if (Object.keys(updatedVotes).length < eligibleVoters) {
      const nextRound: RoundState = { ...round, votes: updatedVotes };
      return {
        kind: "ok",
        state: {
          ...state,
          currentRound: { ...currentRound, state: nextRound },
        },
      };
    }

    const finishedRound = this.#finalize(round, updatedVotes);

    const nextState: GameState = {
      ...state,
      currentRound: { ...currentRound, state: finishedRound },
    };

    return { kind: "ok", state: nextState };
  }

  #finalize(round: RoundState, votes: Record<PlayerId, number>): RoundState {
    const scores = computeVoteScores(round, votes);
    const finished: RoundState = {
      ...round,
      votes,
      scores,
      phase: "finished",
    };

    return finished;
  }
}
