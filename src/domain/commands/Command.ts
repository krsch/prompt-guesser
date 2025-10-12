import type { MessageBus } from "../ports/MessageBus.js";
import type { RoundGateway } from "../ports/RoundGateway.js";
import type { Logger } from "../ports/Logger.js";
import type { TimePoint } from "../typedefs.js";

export interface CommandContext {
  gateway: RoundGateway;
  bus: MessageBus;
  logger?: Logger;
}

export abstract class Command {
  abstract readonly type: string;
  abstract readonly at: TimePoint;
  abstract execute(ctx: CommandContext): Promise<void>;
}
