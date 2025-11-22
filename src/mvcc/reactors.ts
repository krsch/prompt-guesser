import type { GameStateChange } from "./GameStore.js";
import type { Logger } from "../domain/ports/Logger.js";
import type { MessageBus } from "../domain/ports/MessageBus.js";
import type { Scheduler } from "../domain/ports/Scheduler.js";

export interface GameReactorContext {
  readonly bus: MessageBus;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}

export interface GameReactor {
  handle(
    change: GameStateChange,
    ctx: GameReactorContext,
    resultKind: "ok" | "failedRound",
  ): Promise<void>;
}
