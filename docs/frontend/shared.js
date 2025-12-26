export function api(path, options = {}) {
  return fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "same-origin",
    ...options,
  }).then(async (response) => {
    const contentType = response.headers.get("content-type");
    const isJson = contentType?.includes("application/json");
    const body = isJson ? await response.json() : undefined;
    if (!response.ok) {
      const message = body?.error?.message ?? response.statusText;
      throw new Error(message);
    }
    return body;
  });
}

export async function ensureSession(playerName) {
  if (!playerName) throw new Error("Player name is required");
  const session = await api("/session", {
    method: "POST",
    body: JSON.stringify({ playerName }),
  });
  localStorage.setItem("prompt-guesser:player-name", playerName);
  return session;
}

export async function loadSession() {
  try {
    const session = await api("/session");
    if (session?.playerName) {
      localStorage.setItem("prompt-guesser:player-name", session.playerName);
    }
    return session;
  } catch (_error) {
    return null;
  }
}

export function requireSessionOrRedirect(nextPath) {
  return loadSession().then((session) => {
    if (session) return session;
    const loginUrl = new URL("/login", window.location.origin);
    if (nextPath) loginUrl.searchParams.set("next", nextPath);
    window.location.replace(loginUrl.toString());
    return null;
  });
}

export function storedName() {
  return localStorage.getItem("prompt-guesser:player-name") ?? "";
}

export function setRoomCode(value) {
  const badge = document.querySelector("[data-room-code]");
  if (badge) badge.textContent = value;
  const input = document.querySelector('input[name="room-code"]');
  if (input) input.value = value;
}

export function copyRoomCode() {
  const code = document.querySelector("[data-room-code]")?.textContent;
  if (!code || !navigator.clipboard) throw new Error("Clipboard unavailable");
  return navigator.clipboard.writeText(code);
}
