import { RoundNotFoundError } from "../../domain/errors/RoundNotFoundError.js";
import type { RoundGateway, RoundState } from "../../domain/ports/RoundGateway.js";
import type { PlayerId, RoundId, TimePoint } from "../../domain/typedefs.js";

export class InMemoryRoundGateway implements RoundGateway {
  #rounds = new Map<RoundId, RoundState>();
  #nextId = 1;

  async loadRoundState(roundId: RoundId): Promise<RoundState> {
    const state = this.#rounds.get(roundId);
    if (!state) throw new RoundNotFoundError(roundId);
    return this.#clone(state);
  }

  async saveRoundState(state: RoundState, _at: TimePoint): Promise<void> {
    if (!this.#rounds.has(state.id)) throw new RoundNotFoundError(state.id);
    this.#rounds.set(state.id, this.#clone(state));
  }

  async appendPrompt(
    roundId: RoundId,
    playerId: PlayerId,
    prompt: string,
    _at: TimePoint,
  ): Promise<number> {
    const state = this.#rounds.get(roundId);
    if (!state) throw new RoundNotFoundError(roundId);

    state.prompts ??= {};

    const existing = state.prompts[playerId];
    if (existing !== undefined) {
      if (existing !== prompt) {
        throw new Error(`Existing prompt mismatch for player ${playerId}`);
      }
      return Object.keys(state.prompts).length;
    }

    state.prompts[playerId] = prompt;
    return Object.keys(state.prompts).length;
  }

  async appendVote(
    roundId: RoundId,
    playerId: PlayerId,
    promptIndex: number,
    _at: TimePoint,
  ): Promise<number> {
    const state = this.#rounds.get(roundId);
    if (!state) throw new RoundNotFoundError(roundId);

    state.votes ??= {};

    const existing = state.votes[playerId];
    if (existing !== undefined) {
      if (existing !== promptIndex) {
        throw new Error(`Existing vote mismatch for player ${playerId}`);
      }
      return Object.keys(state.votes).length;
    }

    state.votes[playerId] = promptIndex;
    return Object.keys(state.votes).length;
  }

  async countSubmittedPrompts(roundId: RoundId): Promise<number> {
    const state = this.#rounds.get(roundId);
    if (!state) throw new RoundNotFoundError(roundId);
    return Object.keys(state.prompts ?? {}).length;
  }

  async startNewRound(
    players: PlayerId[],
    activePlayer: PlayerId,
    promptDeadline: TimePoint,
    at: TimePoint,
  ): Promise<RoundState> {
    const state: RoundState = {
      id: `round-${this.#nextId++}`,
      players: [...players],
      activePlayer,
      phase: "prompt",
      prompts: {},
      promptDeadline,
      startedAt: at,
    };

    this.#rounds.set(state.id, state);
    return this.#clone(state);
  }

  #clone(state: RoundState): RoundState {
    return JSON.parse(JSON.stringify(state)) as RoundState;
  }
}

