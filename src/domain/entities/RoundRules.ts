import { InvalidRoundStateError } from "../errors/InvalidRoundStateError.js";
import type { PlayerId, RoundPhase, RoundState } from "../ports/RoundGateway.js";

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * Validates the logical consistency of a RoundState.
 * Throws InvalidRoundStateError if any rule is violated.
 */
export function assertValidRoundState(state: RoundState): void {
  const fail = (reason: string): never => {
    throw new InvalidRoundStateError(reason, state);
  };

  // 1. Players
  if (!Array.isArray(state.players) || state.players.length === 0)
    fail("invalid or missing players");
  if (new Set(state.players).size !== state.players.length)
    fail("duplicate player IDs");

  // 2. Active player
  if (!state.players.includes(state.activePlayer))
    fail("active player not in player list");

  // 3. Phase
  const validPhases: RoundPhase[] = [
    "prompt",
    "guessing",
    "voting",
    "scoring",
    "finished",
  ];
  if (!validPhases.includes(state.phase)) fail("invalid phase");

  // 4. startedAt
  if (!state.startedAt || state.startedAt <= 0)
    fail("missing or invalid start time");

  // 5. Prompts, when present, must belong to round players and be strings
  if (state.prompts) {
    for (const [pid, prompt] of Object.entries(state.prompts)) {
      if (!state.players.includes(pid as PlayerId))
        fail("prompt submitted by unknown player");
      if (typeof prompt !== "string") fail("invalid prompt value");
    }
  }

  // 6. Prompt phase: no decoys yet
  if (state.phase === "prompt" && state.prompts) {
    for (const pid of Object.keys(state.prompts)) {
      if (pid !== state.activePlayer)
        fail("unexpected decoy prompt in prompt phase");
    }
  }

  // 7. Guessing+ phase: real prompt must exist and image URL must be set
  if (["guessing", "voting", "scoring", "finished"].includes(state.phase)) {
    const prompts = state.prompts;
    if (!prompts || typeof prompts[state.activePlayer] !== "string")
      fail("missing real prompt");

    if (!state.imageUrl || !/^https?:\/\//.test(state.imageUrl))
      fail("missing or invalid image URL");
  }

  // 8. Voting+ phase: shuffled prompts must align with submitted prompts
  if (["voting", "scoring", "finished"].includes(state.phase)) {
    if (!state.shuffledPrompts || state.shuffledPrompts.length === 0)
      fail("missing shuffled prompts");

    if (!state.shuffledPromptOwners)
      fail("missing shuffled prompt owners");

    const prompts = state.prompts ?? {};

    const sortedPromptValues = Object.values(prompts).sort();
    const sortedShuffledPrompts = [...state.shuffledPrompts].sort();
    if (!arraysEqual(sortedPromptValues, sortedShuffledPrompts))
      fail("shuffled prompts do not match submitted prompts");

    const promptOwners = Object.keys(prompts).sort();
    const shuffledOwners = [...state.shuffledPromptOwners].sort();
    if (!arraysEqual(promptOwners, shuffledOwners))
      fail("shuffled prompt owners do not match prompts");
  }

  // 9. Scoring+ phase: votes and scores must cover every player
  if (["scoring", "finished"].includes(state.phase)) {
    if (!state.votes) fail("missing votes");

    const promptCount = state.shuffledPrompts?.length ?? 0;
    for (const [voterId, index] of Object.entries(state.votes)) {
      const pid = voterId as PlayerId;
      if (!state.players.includes(pid)) fail("vote from unknown player");
      if (pid === state.activePlayer) fail("active player vote recorded");
      if (!Number.isInteger(index) || index < 0 || index >= promptCount)
        fail("invalid vote index recorded");
    }

    if (!state.scores) fail("missing scores");
    for (const pid of state.players)
      if (!(pid in state.scores)) fail("missing player score");
  }
}
