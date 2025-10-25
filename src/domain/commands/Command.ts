import type { GameConfig } from "../GameConfig.js";
import type { ImageGenerator } from "../ports/ImageGenerator.js";
import type { Logger } from "../ports/Logger.js";
import type { MessageBus } from "../ports/MessageBus.js";
import type { RoundGateway } from "../ports/RoundGateway.js";
import type { Scheduler } from "../ports/Scheduler.js";
import type { TimePoint } from "../typedefs.js";

export interface CommandContext {
  readonly gateway: RoundGateway;
  readonly bus: MessageBus;
  readonly imageGenerator: ImageGenerator;
  readonly config: GameConfig;
  readonly scheduler: Scheduler;
  readonly logger?: Logger;
}

export abstract class Command {
  abstract readonly type: string;
  abstract readonly at: TimePoint;
  abstract execute(ctx: CommandContext): Promise<void>;
}
