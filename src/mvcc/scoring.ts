import { StateFailureError } from "./errors.js";
import { canonicalSubmittedPlayers } from "./rules.js";
import type { PlayerId, RoundState } from "./types.js";

export function computeVoteScores(
  round: RoundState,
  votes: Record<PlayerId, number>,
): Record<PlayerId, number> {
  const shuffle = round.shuffleOrder;
  if (!shuffle || shuffle.length === 0) {
    throw new StateFailureError("Missing shuffle order for vote scoring");
  }

  const submittedPlayers = canonicalSubmittedPlayers(round);

  const activeBaseIndex = submittedPlayers.indexOf(round.activePlayer);
  const realPromptIndex = shuffle.indexOf(activeBaseIndex);
  if (realPromptIndex === -1) {
    throw new StateFailureError("Active player prompt not present in shuffle");
  }

  const totalVotes = Object.keys(votes).length;

  const scoreGuessing = (playerId: PlayerId): number => {
    const voteIndex = votes[playerId];
    return voteIndex === realPromptIndex ? 3 : 0;
  };

  const scoreDeception = (playerId: PlayerId): number => {
    if (playerId === round.activePlayer) return 0;
    return Object.values(votes).filter((idx) => {
      const submittedIndex = shuffle[idx];
      if (submittedIndex === undefined) return false;
      return submittedPlayers[submittedIndex] === playerId;
    }).length;
  };

  const correctCount = Object.values(votes).filter(
    (idx) => idx === realPromptIndex,
  ).length;

  const scoreBonus = (playerId: PlayerId): number => {
    if (totalVotes === 0) return 0;

    if (correctCount === 0 || correctCount === totalVotes) {
      return votes[playerId] !== undefined ? 2 : 0;
    }

    return playerId === round.activePlayer ? 3 : 0;
  };

  const entries = round.players.map((pid) => {
    const score = scoreGuessing(pid) + scoreDeception(pid) + scoreBonus(pid);
    return [pid, score] as const;
  });

  return Object.fromEntries(entries) as Record<PlayerId, number>;
}
