import { RoundNotFoundError } from "../../domain/errors/index.js";
import { assertValidRoundState } from "../../domain/entities/RoundRules.js";
import type {
  PromptAppendResult,
  RoundGateway,
  RoundState,
  ValidRoundState,
  VoteAppendResult,
} from "../../domain/ports/RoundGateway.js";
import type { PlayerId, RoundId, TimePoint } from "../../domain/typedefs.js";

export class InMemoryRoundGateway implements RoundGateway {
  #rounds = new Map<RoundId, RoundState>();
  #nextId = 1;

  async loadRoundState(roundId: RoundId): Promise<ValidRoundState> {
    const state = this.#rounds.get(roundId);
    if (!state) throw new RoundNotFoundError(roundId);
    assertValidRoundState(state);
    return this.#clone(state);
  }

  async saveRoundState(state: RoundState): Promise<void> {
    const stored = this.#rounds.get(state.id);
    if (!stored) throw new RoundNotFoundError(state.id);
    assertValidRoundState(stored);

    if (stored.prompts) state.prompts = stored.prompts;
    if (stored.votes) state.votes = stored.votes;

    assertValidRoundState(state);

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
      return {
        inserted: false,
        prompts: { ...state.prompts },
      };
    }

    state.prompts[playerId] = prompt;
    return {
      inserted: true,
      prompts: { ...state.prompts },
    };
  }

  async appendVote(
    roundId: RoundId,
    playerId: PlayerId,
    promptIndex: number,
  ): Promise<VoteAppendResult> {
    const state = this.#rounds.get(roundId);
    if (!state) throw new RoundNotFoundError(roundId);

    state.votes ??= {};

    const existing = state.votes[playerId];
    if (existing !== undefined) {
      if (existing !== promptIndex) {
        throw new Error(`Existing vote mismatch for player ${playerId}`);
      }
      return {
        inserted: false,
        votes: { ...state.votes },
      };
    }

    state.votes[playerId] = promptIndex;
    return {
      inserted: true,
      votes: { ...state.votes },
    };
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
  ): Promise<RoundState> {
    const seedBuffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(seedBuffer);

    const state: RoundState = {
      id: `round-${this.#nextId++}`,
      players: [...players],
      activePlayer,
      phase: "prompt",
      prompts: {},
      seed: seedBuffer[0]!,
      startedAt,
    };

    assertValidRoundState(state);

    this.#rounds.set(state.id, state);
    return this.#clone(state);
  }

  #clone(state: ValidRoundState): ValidRoundState {
    return JSON.parse(JSON.stringify(state)) as ValidRoundState;
  }
}
