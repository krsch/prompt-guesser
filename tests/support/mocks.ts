import { vi, type Mock } from "vitest";

import type { CommandContext } from "../../src/domain/commands/Command.js";
import { GameConfig } from "../../src/domain/GameConfig.js";
import type { ImageGenerator } from "../../src/domain/ports/ImageGenerator.js";
import type { MessageBus } from "../../src/domain/ports/MessageBus.js";
import type { RoundGateway } from "../../src/domain/ports/RoundGateway.js";
import type { Scheduler } from "../../src/domain/ports/Scheduler.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn<T extends (...args: any[]) => unknown> = Mock<T>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMock<T extends (...args: any[]) => unknown>(): Fn<T> {
  return vi.fn<T>();
}

export interface RoundGatewayMock extends RoundGateway {
  readonly loadRoundState: Fn<RoundGateway["loadRoundState"]>;
  readonly saveRoundState: Fn<RoundGateway["saveRoundState"]>;
  readonly appendPrompt: Fn<RoundGateway["appendPrompt"]>;
  readonly appendVote: Fn<RoundGateway["appendVote"]>;
  readonly countSubmittedPrompts: Fn<RoundGateway["countSubmittedPrompts"]>;
  readonly startNewRound: Fn<RoundGateway["startNewRound"]>;
}

export interface MessageBusMock extends MessageBus {
  readonly publish: Fn<MessageBus["publish"]>;
}

export interface SchedulerMock extends Scheduler {
  readonly scheduleTimeout: Fn<Scheduler["scheduleTimeout"]>;
}

export interface ImageGeneratorMock extends ImageGenerator {
  readonly generate: Fn<ImageGenerator["generate"]>;
}

export function createRoundGatewayMock(): RoundGatewayMock {
  return {
    loadRoundState: createMock<RoundGateway["loadRoundState"]>(),
    saveRoundState: createMock<RoundGateway["saveRoundState"]>(),
    appendPrompt: createMock<RoundGateway["appendPrompt"]>(),
    appendVote: createMock<RoundGateway["appendVote"]>(),
    countSubmittedPrompts: createMock<RoundGateway["countSubmittedPrompts"]>(),
    startNewRound: createMock<RoundGateway["startNewRound"]>(),
  };
}

export function createMessageBusMock(): MessageBusMock {
  return {
    publish: createMock<MessageBus["publish"]>(),
  };
}

export function createSchedulerMock(): SchedulerMock {
  return {
    scheduleTimeout: createMock<Scheduler["scheduleTimeout"]>(),
  };
}

export function createImageGeneratorMock(): ImageGeneratorMock {
  return {
    generate: createMock<ImageGenerator["generate"]>(),
  };
}

export interface CommandContextOverrides {
  readonly gateway?: RoundGatewayMock;
  readonly bus?: MessageBusMock;
  readonly imageGenerator?: ImageGeneratorMock;
  readonly scheduler?: SchedulerMock;
  readonly config?: GameConfig;
  readonly logger?: CommandContext["logger"];
}

export interface CommandContextMock extends CommandContext {
  readonly gateway: RoundGatewayMock;
  readonly bus: MessageBusMock;
  readonly imageGenerator: ImageGeneratorMock;
  readonly scheduler: SchedulerMock;
  readonly config: GameConfig;
}

export function createCommandContext(
  overrides: CommandContextOverrides = {},
): CommandContextMock {
  const context = {
    gateway: overrides.gateway ?? createRoundGatewayMock(),
    bus: overrides.bus ?? createMessageBusMock(),
    imageGenerator: overrides.imageGenerator ?? createImageGeneratorMock(),
    scheduler: overrides.scheduler ?? createSchedulerMock(),
    config: overrides.config ?? GameConfig.withDefaults(),
    ...(overrides.logger !== undefined ? { logger: overrides.logger } : {}),
  } satisfies CommandContextMock;

  return context;
}

export function cloneState<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}
