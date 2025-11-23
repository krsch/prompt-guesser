import { CommandError } from "../errors.js";
import type { CommandResult, GameCommand, GameState, PlayerId } from "../types.js";

export class SetLobbyPlayers implements GameCommand {
  readonly type = "SetLobbyPlayers";

  constructor(private readonly players: readonly PlayerId[]) {}

  apply(state: GameState): CommandResult {
    if (this.players.length === 0) {
      return {
        kind: "rejected",
        error: new CommandError("Players list cannot be empty"),
      };
    }

    const uniquePlayers = Array.from(new Set([state.lobby.host, ...this.players]));
    const nextState: GameState = {
      ...state,
      lobby: {
        ...state.lobby,
        players: uniquePlayers,
      },
    };

    return { kind: "ok", state: nextState };
  }
}
