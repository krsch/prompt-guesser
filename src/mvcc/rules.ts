import { StateFailureError } from "./errors.js";
import type { PlayerId, RoundState } from "./types.js";

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function mulberry32(seed: number) {
  return function mulberry32Generator(): number {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomPermutation(n: number, rng: () => number): readonly number[] {
  const permutation = Array.from({ length: n }, (_, index) => index);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    [permutation[i], permutation[j]] = [permutation[j]!, permutation[i]!];
  }
  return permutation;
}

export function canonicalSubmittedPlayers(state: RoundState): readonly PlayerId[] {
  const prompts = state.prompts ?? {};
  return state.players.filter((playerId) => prompts[playerId] !== undefined);
}

export function generateShuffle(state: RoundState): readonly number[] {
  const submitted = canonicalSubmittedPlayers(state);
  const rng = mulberry32(state.seed);
  return randomPermutation(submitted.length, rng);
}

export function getShuffledPrompts(state: RoundState): readonly string[] {
  if (!state.shuffleOrder) return [];
  const submitted = canonicalSubmittedPlayers(state);
  const prompts = state.prompts ?? {};
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return state.shuffleOrder.map((index) => prompts[submitted[index]!]!);
}

export function promptIndexToPlayerId(
  state: RoundState,
  index: number,
): PlayerId | undefined {
  if (!state.shuffleOrder) return undefined;
  if (!Number.isInteger(index)) return undefined;
  if (index < 0 || index >= state.shuffleOrder.length) return undefined;
  const submitted = canonicalSubmittedPlayers(state);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const submittedIndex = state.shuffleOrder[index]!;
  return submitted[submittedIndex];
}

export function assertValidRoundState(state: RoundState): void {
  const fail = (reason: string): never => {
    throw new StateFailureError(`Invalid round state: ${reason}`);
  };

  const ensureDefined = <T>(value: T | undefined, reason: string): T => {
    if (value === undefined) fail(reason);
    return value as T;
  };

  if (!Array.isArray(state.players) || state.players.length === 0)
    fail("invalid or missing players");
  if (new Set(state.players).size !== state.players.length) fail("duplicate player IDs");
  if (!state.players.includes(state.activePlayer))
    fail("active player not in player list");

  const validPhases: readonly RoundState["phase"][] = [
    "prompt",
    "guessing",
    "voting",
    "scoring",
    "finished",
    "failed",
  ];
  if (!validPhases.includes(state.phase)) fail(`invalid phase ${state.phase}`);
  if (!state.startedAt || state.startedAt <= 0) fail("missing or invalid start time");
  if (typeof state.seed !== "number" || !Number.isFinite(state.seed))
    fail("missing or invalid seed");

  if (state.phase === "failed") return;

  if (state.phase === "finished" || state.phase === "scoring") {
    const votes = ensureDefined(state.votes, "missing votes");
    const scores = ensureDefined(state.scores, "missing scores");

    for (const [pid, idx] of Object.entries(votes)) {
      if (!state.players.includes(pid as PlayerId))
        fail(`vote from unknown player ${pid}`);
      if (pid === state.activePlayer) fail("active player vote recorded");
      if (!Number.isInteger(idx) || idx < 0) fail(`invalid vote index from ${pid}`);
    }

    for (const pid of state.players) {
      const val = scores[pid];
      if (val === undefined) fail(`missing score entry for ${pid}`);
      if (typeof val !== "number") fail(`invalid score value for ${pid}`);
    }

    if (!state.shuffleOrder) {
      if (Object.keys(votes).length > 0)
        fail("shuffle order missing with recorded votes");
      return;
    }
  }

  if (state.phase === "voting") {
    const shuffleOrder = ensureDefined(state.shuffleOrder, "missing shuffle order");
    const submittedPlayers = state.players.filter(
      (pid) => state.prompts?.[pid] !== undefined,
    );
    const sorted = [...shuffleOrder].sort((a, b) => a - b);
    const expected = Array.from({ length: submittedPlayers.length }, (_, i) => i);
    if (!arraysEqual(sorted, expected))
      fail("shuffle order is not a valid permutation of submitted prompts");
  }

  if (
    state.phase === "guessing" ||
    state.phase === "voting" ||
    state.phase === "scoring" ||
    state.phase === "finished"
  ) {
    const prompts = ensureDefined(state.prompts, "missing prompts");

    if (typeof prompts[state.activePlayer] !== "string")
      fail("missing real prompt from active player");
    if (!state.imageUrl || !/^https?:\/\//.test(state.imageUrl))
      fail("missing or invalid image URL");
    for (const [pid, prompt] of Object.entries(prompts)) {
      if (!state.players.includes(pid as PlayerId))
        fail(`prompt submitted by unknown player ${pid}`);
      if (typeof prompt !== "string") fail(`invalid prompt value from ${pid}`);
    }
  }

  if (state.phase === "prompt") {
    if (state.prompts) {
      for (const pid of Object.keys(state.prompts)) {
        if (pid !== state.activePlayer) fail("unexpected decoy prompt in prompt phase");
      }
    }
  }
}
