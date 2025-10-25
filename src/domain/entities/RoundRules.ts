import type { RoundState, ValidRoundState } from "../ports/RoundGateway.js";
import type { PlayerId, RoundPhase } from "../typedefs.js";
import { InvalidRoundStateError } from "../errors/InvalidRoundStateError.js";

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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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

// -----------------------------------------------------------------------------
//  Assertion function: runtime check + static type narrowing
// -----------------------------------------------------------------------------
export function assertValidRoundState(
  state: RoundState,
): asserts state is ValidRoundState {
  /* eslint-disable @typescript-eslint/no-fallthrough */
  const fail = (reason: string): never => {
    throw new InvalidRoundStateError(reason, state);
  };

  const ensureDefined = <T>(value: T | undefined, reason: string): T => {
    if (value === undefined) throw new InvalidRoundStateError(reason, state);
    return value;
  };

  const arraysEqual = <T>(a: readonly T[], b: readonly T[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  // --- 1. Generic invariants -------------------------------------------------
  if (!Array.isArray(state.players) || state.players.length === 0)
    fail("invalid or missing players");
  if (new Set(state.players).size !== state.players.length) fail("duplicate player IDs");
  if (!state.players.includes(state.activePlayer))
    fail("active player not in player list");

  const validPhases: readonly RoundPhase[] = [
    "prompt",
    "guessing",
    "voting",
    "scoring",
    "finished",
  ];
  if (!validPhases.includes(state.phase)) fail("invalid phase");

  if (!state.startedAt || state.startedAt <= 0) fail("missing or invalid start time");

  if (typeof state.seed !== "number" || !Number.isFinite(state.seed))
    fail("missing or invalid seed");

  // --- 2. Phase-specific invariants with progressive fallthrough -------------
  switch (state.phase) {
    // @ts-ignore TS7029: intentional progressive validation fallthrough
    case "finished": {
      const scores = ensureDefined(state.scores, "missing scores");

      for (const pid of state.players) {
        const val = scores[pid];
        if (val === undefined) fail(`missing score entry for ${pid}`);
        if (typeof val !== "number") fail(`invalid score value for ${pid}`);
      }
    }

    // @ts-ignore TS7029: intentional progressive validation fallthrough
    case "scoring": {
      const votes = ensureDefined(state.votes, "missing votes");

      for (const [pid, idx] of Object.entries(votes)) {
        if (!state.players.includes(pid as PlayerId))
          fail(`vote from unknown player ${pid}`);
        if (pid === state.activePlayer) fail("active player vote recorded");
        if (!Number.isInteger(idx) || idx < 0) fail(`invalid vote index from ${pid}`);
      }
    }

    // @ts-ignore TS7029: intentional progressive validation fallthrough
    case "voting": {
      const shuffleOrder = ensureDefined(state.shuffleOrder, "missing shuffle order");

      const submittedPlayers = state.players.filter(
        (pid) => state.prompts?.[pid] !== undefined,
      );
      const sorted = [...shuffleOrder].sort((a, b) => a - b);
      const expected = Array.from({ length: submittedPlayers.length }, (_, i) => i);
      if (!arraysEqual(sorted, expected))
        fail("shuffle order is not a valid permutation");
    }

    // @ts-ignore TS7029: intentional progressive validation fallthrough
    case "guessing": {
      const prompts = ensureDefined(state.prompts, "missing prompts");

      if (typeof prompts[state.activePlayer] !== "string") fail("missing real prompt");
      if (!state.imageUrl || !/^https?:\/\//.test(state.imageUrl))
        fail("missing or invalid image URL");

      for (const [pid, prompt] of Object.entries(prompts)) {
        if (!state.players.includes(pid as PlayerId))
          fail(`prompt submitted by unknown player ${pid}`);
        if (typeof prompt !== "string") fail(`invalid prompt value from ${pid}`);
      }
    }

    case "prompt": {
      if (state.phase === "prompt" && state.prompts) {
        for (const pid of Object.keys(state.prompts)) {
          if (pid !== state.activePlayer) fail("unexpected decoy prompt in prompt phase");
        }
      }
      break;
    }

    default:
      fail(`invalid phase: ${String(state.phase)}`);
  }
}
