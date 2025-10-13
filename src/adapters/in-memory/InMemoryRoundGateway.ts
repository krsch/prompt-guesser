import { RoundNotFoundError } from "../../domain/errors/RoundNotFoundError.js";
import type { PromptAppendResult, RoundGateway, RoundState } from "../../domain/ports/RoundGateway.js";
import type { PlayerId, RoundId, TimePoint } from "../../domain/typedefs.js";

export class InMemoryRoundGateway implements RoundGateway {
  #rounds = new Map<RoundId, RoundState>();
  #nextId = 1;

  async loadRoundState(roundId: RoundId): Promise<RoundState> {
    const state = this.#rounds.get(roundId);
    if (!state) throw new RoundNotFoundError(roundId);
    return this.#clone(state);
  }

  async saveRoundState(state: RoundState): Promise<void> {
    if (!this.#rounds.has(state.id)) throw new RoundNotFoundError(state.id);
    this.#rounds.set(state.id, this.#clone(state));
  }

  async appendPrompt(
    roundId: RoundId,
    playerId: PlayerId,
    prompt: string,
  ): Promise<PromptAppendResult> {
    const state = this.#rounds.get(roundId);
    if (!state) throw new RoundNotFoundError(roundId);

    state.prompts ??= {};

    const existing = state.prompts[playerId];
    if (existing !== undefined) {
      if (existing !== prompt) {
        throw new Error(`Existing prompt mismatch for player ${playerId}`);
      }
      return { count: Object.keys(state.prompts).length, inserted: false };
    }

    state.prompts[playerId] = prompt;
    return { count: Object.keys(state.prompts).length, inserted: true };
  }

  async appendVote(
    roundId: RoundId,
    playerId: PlayerId,
    promptIndex: number,
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
    startedAt: TimePoint,
    promptDeadline: TimePoint,
  ): Promise<RoundState> {
    const state: RoundState = {
      id: `round-${this.#nextId++}`,
      players: [...players],
      activePlayer,
      phase: "prompt",
      prompts: {},
      startedAt,
      promptDeadline,
    };

    this.#rounds.set(state.id, state);
    return this.#clone(state);
  }

  #clone(state: RoundState): RoundState {
    return JSON.parse(JSON.stringify(state)) as RoundState;
  }
}

