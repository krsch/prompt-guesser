import type { MessageBus } from "../ports/MessageBus.js";
import type { RoundGateway } from "../ports/RoundGateway.js";
import type { Logger } from "../ports/Logger.js";
import type { ImageGenerator } from "../ports/ImageGenerator.js";
import type { Scheduler } from "../ports/Scheduler.js";
import { GameConfig } from "../GameConfig.js";
import type { TimePoint } from "../typedefs.js";

export interface CommandContext {
  gateway: RoundGateway;
  bus: MessageBus;
  imageGenerator: ImageGenerator;
  config: GameConfig;
  scheduler: Scheduler;
  logger?: Logger;
}

export abstract class Command {
  abstract readonly type: string;
  abstract readonly at: TimePoint;
  abstract execute(ctx: CommandContext): Promise<void>;
}
