import type {
  DurableObjectNamespace,
  DurableObjectState,
  Request as CfRequest,
  Response as CfResponse,
} from "@cloudflare/workers-types";

import { DurableObjectBus } from "./adapters/DurableObjectBus.js";
import { DurableObjectGameStore } from "./adapters/DurableObjectGameStore.js";
import { DurableObjectScheduler } from "./adapters/DurableObjectScheduler.js";
import { OpenAIImageGenerator } from "./adapters/OpenAIImageGenerator.js";
import {
  BroadcastReactor,
  GameService,
  ImageGenerationReactor,
  JoinLobby,
  KickLobbyPlayer,
  LeaveLobby,
  PhaseSchedulerReactor,
  SetLobbyPlayers,
  StartNextRound,
  SubmitDecoy,
  SubmitPrompt,
  SubmitVote,
  createGameConfig,
  projectVisibleState,
  type GameConfig,
  type GameId,
  type RoundId,
  type VisibleGameState,
} from "./core.js";
import { createConsoleLogger } from "./logger.js";

export interface Env {
  readonly GAME: DurableObjectNamespace;
  readonly OPENAI_API_KEY?: string;
}

type CfServerWebSocket = WebSocket & { accept(): void };
declare const WebSocketPair: new () => {
  readonly 0: WebSocket;
  readonly 1: CfServerWebSocket;
};

const JSON_HEADERS = { "content-type": "application/json" } as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ ok: true, timestamp: Date.now() }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    if (url.pathname === "/api/games" && request.method === "POST") {
      const gameId = `game-${crypto.randomUUID()}`;
      const body = await request.text();
      const stub = env.GAME.get(env.GAME.idFromName(gameId));
      const stubRequest = createStubRequest("/api/create", request, gameId, body);
      const response = (await stub.fetch(stubRequest as CfRequest)) as CfResponse;
      const headers = new Headers();
      response.headers.forEach((value, key) => headers.append(key, value));
      headers.set("Location", `/api/games/${gameId}`);
      return new Response(await response.text(), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    if (url.pathname.startsWith("/ws/")) {
      const [, , gameId] = url.pathname.split("/");
      if (!gameId) {
        return new Response("Game id required", { status: 400 });
      }
      const stub = env.GAME.get(env.GAME.idFromName(gameId));
      const stubRequest = createStubRequest("/ws", request, gameId);
      const stubResponse = (await stub.fetch(stubRequest as CfRequest)) as CfResponse;
      return stubResponse as unknown as Response;
    }

    const gameMatch = url.pathname.match(/^\/api\/games\/(?<gameId>[^/]+)(?<rest>.*)$/);
    const gameId = gameMatch?.groups?.["gameId"];
    const rest = gameMatch?.groups?.["rest"] ?? "";

    if (!gameId) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }
    const stub = env.GAME.get(env.GAME.idFromName(gameId));

    const body = request.method === "POST" ? await request.text() : undefined;
    const targetPath = mapPath(rest, request.method);
    if (!targetPath) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }
    const stubRequest = createStubRequest(targetPath, request, gameId, body);
    const stubResponse = (await stub.fetch(stubRequest as CfRequest)) as CfResponse;
    return stubResponse as unknown as Response;
  },
};

function mapPath(rest: string, method: string): string | null {
  if (rest === "" && method === "GET") return "/api/state";
  if (rest === "/lobby/join" && method === "POST") return "/api/lobby/join";
  if (rest === "/lobby/leave" && method === "POST") return "/api/lobby/leave";
  if (rest === "/lobby/kick" && method === "POST") return "/api/lobby/kick";
  if (rest === "/rounds/start" && method === "POST") return "/api/rounds/start";

  const roundMatch = rest.match(/^\/rounds\/(?<roundId>[^/]+)(?<suffix>.*)$/);
  const roundId = roundMatch?.groups?.["roundId"];
  const suffix = roundMatch?.groups?.["suffix"] ?? "";

  if (!roundId) {
    return null;
  }

  if (suffix === "" && method === "GET") return `/api/rounds/${roundId}`;
  if (suffix === "/prompt" && method === "POST") return `/api/rounds/${roundId}/prompt`;
  if (suffix === "/decoy" && method === "POST") return `/api/rounds/${roundId}/decoy`;
  if (suffix === "/vote" && method === "POST") return `/api/rounds/${roundId}/vote`;

  return null;
}

function createStubRequest(
  path: string,
  request: Request,
  gameId: string,
  body?: string,
): CfRequest {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    headers.append(key, value);
  });
  headers.set("x-game-id", gameId);
  const init: RequestInit =
    body === undefined
      ? { method: request.method, headers }
      : { method: request.method, headers, body };
  return new Request(`https://do${path}`, init) as unknown as CfRequest;
}

export class PromptGuesserDurableObject {
  readonly #state: DurableObjectState;
  readonly #env: Env;
  readonly #logger = createConsoleLogger("backend-cloudflare");
  readonly #store: DurableObjectGameStore;
  readonly #bus: DurableObjectBus;
  readonly #scheduler: DurableObjectScheduler;
  readonly #service: GameService;
  readonly #defaultConfig: GameConfig;
  // eslint-disable-next-line functional/prefer-readonly-type
  #gameId: GameId | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.#state = state;
    this.#env = env;
    this.#store = new DurableObjectGameStore(state);
    this.#bus = new DurableObjectBus(this.#logger);
    this.#defaultConfig = createGameConfig();

    let service: GameService;
    this.#scheduler = new DurableObjectScheduler({
      state,
      logger: this.#logger,
      runTimeout: async (cmd, gameId): Promise<void> => service.run(gameId, cmd),
    });

    const reactors = [
      new BroadcastReactor(),
      new PhaseSchedulerReactor(),
      new ImageGenerationReactor(
        createImageGenerator(this.#env.OPENAI_API_KEY, this.#logger),
      ),
    ];

    service = new GameService({
      store: this.#store,
      reactors,
      reactorContext: {
        bus: this.#bus,
        scheduler: this.#scheduler,
        logger: this.#logger,
      },
    });

    this.#service = service;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") {
      return this.#handleWebSocket(request);
    }

    const gameId = await this.#resolveGameId(request);

    if (url.pathname === "/api/create" && request.method === "POST") {
      return this.#handleCreate(gameId, request);
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      return this.#respondWithVisibleState(gameId);
    }

    if (url.pathname === "/api/lobby/join" && request.method === "POST") {
      return this.#handleCommand(
        gameId,
        async (body) => {
          const playerId = requireString(body["playerId"], "playerId");
          await this.#service.run(gameId, new JoinLobby(playerId));
          return this.#respondWithVisibleState(gameId);
        },
        request,
      );
    }

    if (url.pathname === "/api/lobby/leave" && request.method === "POST") {
      return this.#handleCommand(
        gameId,
        async (body) => {
          const playerId = requireString(body["playerId"], "playerId");
          await this.#service.run(gameId, new LeaveLobby(playerId));
          return this.#respondWithVisibleState(gameId);
        },
        request,
      );
    }

    if (url.pathname === "/api/lobby/kick" && request.method === "POST") {
      return this.#handleCommand(
        gameId,
        async (body) => {
          const playerId = requireString(body["playerId"], "playerId");
          await this.#service.run(gameId, new KickLobbyPlayer(playerId));
          return this.#respondWithVisibleState(gameId);
        },
        request,
      );
    }

    if (url.pathname === "/api/rounds/start" && request.method === "POST") {
      return this.#handleCommand(
        gameId,
        async (body) => {
          const players = requireStringArray(body["players"], "players");
          const fallbackActivePlayer = players[0];
          const activePlayer =
            typeof body["activePlayer"] === "string"
              ? (body["activePlayer"] as string)
              : fallbackActivePlayer;
          if (!activePlayer) {
            throw new Error("activePlayer is required");
          }
          const now = Date.now();
          const roundId = `round-${now}` as RoundId;
          const seed = now;

          await this.#service.run(gameId, new SetLobbyPlayers(players));
          await this.#service.run(
            gameId,
            new StartNextRound(roundId, activePlayer, seed, now),
          );
          await this.#scheduler.scheduleTimeout(
            roundId,
            "prompt",
            this.#defaultConfig.promptDurationMs,
            gameId,
          );
          return new Response(JSON.stringify(await this.#visibleState(gameId)), {
            status: 201,
            headers: {
              ...JSON_HEADERS,
              Location: `/api/games/${gameId}/rounds/${roundId}`,
            },
          });
        },
        request,
      );
    }

    const roundMatch = url.pathname.match(
      /^\/api\/rounds\/(?<roundId>[^/]+)(?<suffix>.*)$/,
    );
    if (roundMatch?.groups?.["roundId"]) {
      const roundId = roundMatch.groups["roundId"] as RoundId;
      const suffix = roundMatch.groups["suffix"] ?? "";

      if (suffix === "" && request.method === "GET") {
        const visible = (await this.#visibleState(gameId)).currentRound?.state;
        if (!visible || visible.id !== roundId) {
          return new Response(JSON.stringify({ error: "Round not found" }), {
            status: 404,
            headers: JSON_HEADERS,
          });
        }
        return new Response(JSON.stringify(visible), {
          status: 200,
          headers: JSON_HEADERS,
        });
      }

      if (suffix === "/prompt" && request.method === "POST") {
        return this.#handleCommand(
          gameId,
          async (body) => {
            const playerId = requireString(body["playerId"], "playerId");
            const prompt = requireString(body["prompt"], "prompt");
            await this.#service.run(gameId, new SubmitPrompt(roundId, playerId, prompt));
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: JSON_HEADERS,
            });
          },
          request,
        );
      }

      if (suffix === "/decoy" && request.method === "POST") {
        return this.#handleCommand(
          gameId,
          async (body) => {
            const playerId = requireString(body["playerId"], "playerId");
            const prompt = requireString(body["prompt"], "prompt");
            await this.#service.run(gameId, new SubmitDecoy(roundId, playerId, prompt));
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: JSON_HEADERS,
            });
          },
          request,
        );
      }

      if (suffix === "/vote" && request.method === "POST") {
        return this.#handleCommand(
          gameId,
          async (body) => {
            const playerId = requireString(body["playerId"], "playerId");
            const promptIndex = requireNumber(body["promptIndex"], "promptIndex");
            await this.#service.run(
              gameId,
              new SubmitVote(roundId, playerId, promptIndex),
            );
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: JSON_HEADERS,
            });
          },
          request,
        );
      }
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }

  async alarm(): Promise<void> {
    await this.#scheduler.triggerAlarm();
  }

  async #handleCreate(gameId: GameId, request: Request): Promise<Response> {
    const existing = await this.#state.storage.get("game");
    if (existing) {
      return new Response(JSON.stringify({ error: "Game already exists" }), {
        status: 409,
        headers: JSON_HEADERS,
      });
    }

    const { host } = await safeJson(request);
    const resolvedHost = (host as string | undefined) ?? "host";
    await this.#service.createGame({
      id: gameId,
      lobby: { host: resolvedHost, players: [resolvedHost], config: this.#defaultConfig },
    });
    return this.#respondWithVisibleState(gameId, 201, {
      Location: `/api/games/${gameId}`,
    });
  }

  async #handleWebSocket(request: Request): Promise<Response> {
    const gameId = await this.#resolveGameId(request);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (!client || !server) {
      throw new Error("Failed to establish WebSocket pair");
    }
    this.#bus.setChannel(gameId);
    this.#bus.addConnection(server);
    server.accept();
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & {
      readonly webSocket: WebSocket;
    });
  }

  async #handleCommand(
    gameId: GameId,
    run: (body: Record<string, unknown>) => Promise<Response>,
    request: Request,
  ): Promise<Response> {
    try {
      const body = await safeJson(request);
      return await run(body);
    } catch (error) {
      this.#logger.error("Command failed", { error });
      return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
  }

  async #respondWithVisibleState(
    gameId: GameId,
    status = 200,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const visible = await this.#visibleState(gameId);
    const headers = new Headers(JSON_HEADERS);
    if (extraHeaders) {
      for (const [key, value] of Object.entries(extraHeaders)) {
        headers.set(key, value);
      }
    }
    return new Response(JSON.stringify(visible), { status, headers });
  }

  async #visibleState(gameId: GameId): Promise<VisibleGameState> {
    const state = await this.#store.loadGame(gameId);
    return projectVisibleState(state);
  }

  async #resolveGameId(request: Request): Promise<GameId> {
    const fromHeader = request.headers.get("x-game-id");
    if (fromHeader) {
      this.#setGameId(fromHeader as GameId);
      return fromHeader as GameId;
    }

    if (this.#gameId) return this.#gameId;

    const stored = (await this.#state.storage.get("game")) as
      | { readonly id: GameId }
      | undefined;
    if (stored?.id) {
      this.#setGameId(stored.id);
      return stored.id;
    }

    throw new Error("Game id missing");
  }

  #setGameId(gameId: GameId): void {
    // eslint-disable-next-line functional/immutable-data
    this.#gameId = gameId;
    this.#bus.setChannel(gameId);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(`${field} must be a number`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function createImageGenerator(
  apiKey: string | undefined,
  logger: Readonly<ReturnType<typeof createConsoleLogger>>,
): OpenAIImageGenerator | { readonly generate: (prompt: string) => Promise<string> } {
  if (apiKey) {
    return new OpenAIImageGenerator({ apiKey, logger });
  }
  return {
    async generate(prompt: string): Promise<string> {
      const encoded = encodeURIComponent(prompt);
      return `https://dummyimage.com/1024x1024/1f2937/ffffff&text=${encoded}`;
    },
  } satisfies { readonly generate: (prompt: string) => Promise<string> };
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  const text = await request.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}
