import type { GameStateChange } from "./GameStore.js";
import type { GameCommand, GameId } from "./types.js";
import type { Logger } from "../domain/ports/Logger.js";
import type { MessageBus } from "../domain/ports/MessageBus.js";
import type { Scheduler } from "../domain/ports/Scheduler.js";

export interface GameReactorContextBase {
  readonly bus: MessageBus;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}

export interface GameReactorContext extends GameReactorContextBase {
  readonly service: {
    run(gameId: GameId, command: GameCommand): Promise<void>;
  };
}

export interface GameReactor {
  handle(
    change: GameStateChange,
    ctx: GameReactorContext,
    resultKind: "ok" | "failedRound",
  ): Promise<void>;
}
