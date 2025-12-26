export interface Session {
  readonly id: string;
  readonly playerName: string;
  readonly createdAt: number;
}

export interface SessionStore {
  create(playerName: string): Session;
  get(sessionId: string): Session | undefined;
}

export function createSessionStore(): SessionStore {
  const store = new Map<string, Session>();

  return {
    create(playerName: string): Session {
      const session: Session = {
        id: `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        playerName,
        createdAt: Date.now(),
      };
      // Sessions are ephemeral and intentionally mutable for the in-memory store.
      // eslint-disable-next-line functional/immutable-data
      store.set(session.id, session);
      return session;
    },
    get(sessionId: string): Session | undefined {
      return store.get(sessionId);
    },
  };
}
