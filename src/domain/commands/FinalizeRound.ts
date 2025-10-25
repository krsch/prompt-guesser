import { canonicalSubmittedPlayers } from "../entities/RoundRules.js";
import type { Logger } from "../ports/Logger.js";
import type { MessageBus } from "../ports/MessageBus.js";
import type { RoundGateway, RoundState, ValidRoundState } from "../ports/RoundGateway.js";
import type { PlayerId, TimePoint } from "../typedefs.js";

export async function finalizeRound(
  state: ValidRoundState & { phase: "voting" },
  at: TimePoint,
  gateway: RoundGateway,
  bus: MessageBus,
  logger?: Logger,
  source: string = "FinalizeRound",
): Promise<void> {
  const submittedPlayers = canonicalSubmittedPlayers(state);
  const shuffleOrder = state.shuffleOrder!;

  const scores: Record<PlayerId, number> = Object.fromEntries(
    state.players.map((playerId) => [playerId, 0]),
  );

  const votes = state.votes!;
  const voteEntries = Object.entries(votes) as [PlayerId, number][];

  const activeBaseIndex = submittedPlayers.indexOf(state.activePlayer);
  const realPromptIndex = shuffleOrder.indexOf(activeBaseIndex);

  let correctGuesses = 0;
  for (const [voterId, voteIndex] of voteEntries) {
    if (voteIndex === realPromptIndex) {
      scores[voterId]! += 3;
      correctGuesses += 1;
      continue;
    }

    const ownerId = submittedPlayers[shuffleOrder[voteIndex]!]!;
    scores[ownerId]! += 1;
  }

  const totalVotes = voteEntries.length;

  if (totalVotes > 0 && (correctGuesses === 0 || correctGuesses === totalVotes)) {
    for (const [voterId] of voteEntries) {
      scores[voterId]! += 2;
    }
  } else if (correctGuesses > 0 && correctGuesses < totalVotes) {
    scores[state.activePlayer]! += 3;
  }

  const newstate = {...state, scores, phase: "scoring"} as ValidRoundState;

  await gateway.saveRoundState(newstate);
  logger?.info?.("Round entering scoring", {
    roundId: state.id,
    at,
    type: source,
    phase: newstate.phase,
  });

  await bus.publish(`round:${state.id}`, {
    type: "PhaseChanged",
    phase: newstate.phase,
    at,
  });

  const finstate = {...newstate, phase: "finished", finishedAt: at} as ValidRoundState;
  await gateway.saveRoundState(finstate);

  logger?.info?.("Round finished", {
    roundId: state.id,
    at,
    type: source,
  });

  await bus.publish(`round:${state.id}`, {
    type: "RoundFinished",
    roundId: state.id,
    at,
    scores,
  });
}
