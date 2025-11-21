import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Context } from "hono";
import type { WSContext } from "hono/ws";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { WebSocket } from "ws";

import { OpenAIImageGenerator } from "./adapters/OpenAIImageGenerator.js";
import { RealScheduler } from "./adapters/RealScheduler.js";
import { WebSocketBus } from "./adapters/WebSocketBus.js";
import { createBackendApp } from "./app.js";
import { GameConfig, InMemoryRoundGateway, dispatchCommand } from "./core.js";
import type { CommandContext, ImageGenerator, Logger } from "./core.js";
import { createConsoleLogger } from "./logger.js";

const DEFAULT_PORT = Number(process.env["PORT"] ?? 8787);
const OPENAI_API_KEY = process.env["OPENAI_API_KEY"] ?? "";

export async function startServer(): Promise<void> {
  const logger = createConsoleLogger("backend-local");
  const gateway = new InMemoryRoundGateway();
  const bus = new WebSocketBus(logger);
  const config = GameConfig.withDefaults();
  const imageGenerator = createImageGenerator(logger);

  let scheduler: RealScheduler;

  const createContext = (): CommandContext => ({
    gateway,
    bus,
    imageGenerator,
    config,
    scheduler,
    logger,
  });

  scheduler = new RealScheduler({
    contextFactory: async (): Promise<CommandContext> => createContext(),
    logger,
  });

  const app = createBackendApp({
    port: DEFAULT_PORT,
    gateway,
    bus,
    logger,
    createContext,
    dispatch: dispatchCommand,
  });

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  app.get(
    "/ws/:roundId",
    upgradeWebSocket((c: Context) => {
      const roundId = c.req.param("roundId");
      return {
        onOpen(_event: Event, ws: WSContext<WebSocket>): void {
          const rawSocket = ws.raw;
          if (!rawSocket) {
            logger.warn("WebSocket connection missing raw handle", { roundId });
            return;
          }
          bus.attach(`round:${roundId}`, rawSocket);
        },
      };
    }),
  );

  const frontendPath = resolveFrontendPath();
  if (frontendPath) {
    app.get("/*", async (c: Context): Promise<Response> => {
      const filePath = join(frontendPath, "index.html");
      if (!existsSync(filePath)) {
        return c.json({ error: "Frontend build not found" }, 404);
      }

      const { readFile } = await import("node:fs/promises");
      const contents = await readFile(filePath, "utf8");
      return c.html(contents);
    });
  }

  const server = serve({ fetch: app.fetch, port: DEFAULT_PORT }, (info: AddressInfo) => {
    logger.info("Server listening", info);
  });

  injectWebSocket(server);
}

function resolveFrontendPath(): string | null {
  const current = fileURLToPath(new URL(".", import.meta.url));
  const candidate = join(current, "../../frontend/dist");
  if (existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function createImageGenerator(logger: Logger): ImageGenerator {
  if (!OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY is not set. Using placeholder image generator.");
    return {
      async generate(prompt: string): Promise<string> {
        const encodedPrompt = encodeURIComponent(prompt);
        return `https://dummyimage.com/1024x1024/1f2937/ffffff&text=${encodedPrompt}`;
      },
    } satisfies ImageGenerator;
  }

  return new OpenAIImageGenerator({ apiKey: OPENAI_API_KEY, logger });
}

void startServer().catch((error) => {
  createConsoleLogger("backend-local").error("Failed to start backend", { error });
  process.exit(1);
});
