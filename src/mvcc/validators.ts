import { StateFailureError } from "./errors.js";
import { assertValidRoundState } from "./rules.js";
import type { GameState } from "./types.js";

export function assertValidGameState(state: GameState): void {
  if (!state.id) throw new StateFailureError("Game state missing id");
  if (!state.lobby) throw new StateFailureError("Game state missing lobby");
  if (!Array.isArray(state.lobby.players) || state.lobby.players.length === 0)
    throw new StateFailureError("Lobby players missing or empty");

  if (state.currentRound) {
    if (state.currentRound.id !== state.currentRound.state.id) {
      throw new StateFailureError("Current round id mismatch");
    }
    assertValidRoundState(state.currentRound.state);
  }
}
