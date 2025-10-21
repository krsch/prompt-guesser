import { InvalidRoundStateError } from "../errors/InvalidRoundStateError.js";
import type { PlayerId, RoundPhase, RoundState } from "../ports/RoundGateway.js";

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function mulberry32(seed: number) {
  return function mulberry32Generator() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomPermutation(n: number, rng: () => number): number[] {
  const permutation = Array.from({ length: n }, (_, index) => index);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [permutation[i], permutation[j]] = [permutation[j]!, permutation[i]!];
  }
  return permutation;
}

export function canonicalSubmittedPlayers(state: RoundState): PlayerId[] {
  const prompts = state.prompts ?? {};
  return state.players.filter((playerId) => prompts[playerId] !== undefined);
}

export function generateShuffle(state: RoundState): number[] {
  const submitted = canonicalSubmittedPlayers(state);
  const rng = mulberry32(state.seed);
  return randomPermutation(submitted.length, rng);
}

export function getShuffledPrompts(state: RoundState): string[] {
  if (!state.shuffleOrder) return [];
  const submitted = canonicalSubmittedPlayers(state);
  return state.shuffleOrder.map((index) => state.prompts?.[submitted[index]!]!);
}

export function promptIndexToPlayerId(
  state: RoundState,
  index: number,
): PlayerId | undefined {
  if (!state.shuffleOrder) return undefined;
  if (!Number.isInteger(index)) return undefined;
  if (index < 0 || index >= state.shuffleOrder.length) return undefined;
  const submitted = canonicalSubmittedPlayers(state);
  const submittedIndex = state.shuffleOrder[index]!;
  return submitted[submittedIndex];
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

  // 5. Seed must be a finite number
  if (typeof state.seed !== "number" || !Number.isFinite(state.seed))
    fail("missing or invalid seed");

  // 6. Prompts, when present, must belong to round players and be strings
  if (state.prompts) {
    for (const [pid, prompt] of Object.entries(state.prompts)) {
      if (!state.players.includes(pid as PlayerId))
        fail("prompt submitted by unknown player");
      if (typeof prompt !== "string") fail("invalid prompt value");
    }
  }

  // 7. Prompt phase: no decoys yet
  if (state.phase === "prompt" && state.prompts) {
    for (const pid of Object.keys(state.prompts)) {
      if (pid !== state.activePlayer)
        fail("unexpected decoy prompt in prompt phase");
    }
  }

  // 8. Guessing+ phase: real prompt must exist and image URL must be set
  if (["guessing", "voting", "scoring", "finished"].includes(state.phase)) {
    const prompts = state.prompts;
    if (!prompts || typeof prompts[state.activePlayer] !== "string")
      fail("missing real prompt");

    if (!state.imageUrl || !/^https?:\/\//.test(state.imageUrl))
      fail("missing or invalid image URL");
  }

  // 9. Voting+ phase: shuffle order must align with submitted prompts
  if (["voting", "scoring", "finished"].includes(state.phase)) {
    const submittedPlayers = canonicalSubmittedPlayers(state);

    if (submittedPlayers.length === 0)
      fail("no submitted prompts to shuffle");

    const { shuffleOrder } = state;
    if (!Array.isArray(shuffleOrder) || shuffleOrder.length === 0)
      fail("missing shuffle order");

    if (shuffleOrder.length !== submittedPlayers.length)
      fail("shuffle order length mismatch");

    if (!shuffleOrder.every((index) => Number.isInteger(index)))
      fail("shuffle order contains invalid indices");

    const sorted = [...shuffleOrder].sort((a, b) => a - b);
    const expected = Array.from({ length: submittedPlayers.length }, (_, i) => i);
    if (!arraysEqual(sorted, expected)) fail("shuffle order is not a permutation");
  }

  // 10. Scoring+ phase: votes and scores must cover every player
  if (["scoring", "finished"].includes(state.phase)) {
    if (!state.votes) fail("missing votes");

    const promptCount = state.shuffleOrder?.length ?? 0;
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
