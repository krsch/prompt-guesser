import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Context } from "hono";
import type { WSContext } from "hono/ws";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";

import { RealScheduler } from "./adapters/RealScheduler.js";
import { WebSocketBus } from "./adapters/WebSocketBus.js";
import { createBackendApp } from "./app.js";
import {
  BroadcastReactor,
  GameService,
  InMemoryGameStore,
  createGameConfig,
} from "./core.js";
import type { PhaseTimeout } from "./core.js";
import type { GameId } from "./core.js";
import { createConsoleLogger } from "./logger.js";

const DEFAULT_PORT = Number(process.env["PORT"] ?? 8787);
export async function startServer(): Promise<void> {
  const logger = createConsoleLogger("backend-local");
  const bus = new WebSocketBus(logger);
  const config = createGameConfig();
  const gameStore = new InMemoryGameStore();
  const initialGame = {
    id: "game-1" as GameId,
    lobby: {
      host: "host",
      players: ["host"],
      config,
    },
  };
  await gameStore.createGame(initialGame);
  let activeGameId: GameId = initialGame.id;

  let service: GameService;
  const scheduler = new RealScheduler({
    runTimeout: async (cmd: PhaseTimeout): Promise<void> =>
      service.run(activeGameId, cmd),
    logger,
  });
  service = new GameService({
    store: gameStore,
    reactors: [new BroadcastReactor()],
    reactorContext: { bus, scheduler, logger },
  });

  const app = createBackendApp({
    port: DEFAULT_PORT,
    gameStore,
    bus,
    defaultConfig: config,
    logger,
    service,
    scheduler,
  });

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  app.get(
    "/ws/:gameId",
    upgradeWebSocket((c: Context) => {
      const gameId = c.req.param("gameId");
      return {
        onOpen(_event: Event, ws: WSContext<WebSocket>): void {
          const rawSocket = ws.raw;
          if (!rawSocket) {
            logger.warn("WebSocket connection missing raw handle", { gameId });
            return;
          }
          bus.attach(`game:${gameId}`, rawSocket);
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

void startServer().catch((error) => {
  createConsoleLogger("backend-local").error("Failed to start backend", { error });
  process.exit(1);
});
