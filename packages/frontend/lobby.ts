import {
  api,
  copyRoomCode,
  ensureSession,
  loadSession,
  setRoomCode,
  storedName,
} from "./shared.js";

declare global {
  interface Window {
    hostRoom: () => Promise<void>;
    copyLastRoomCode: () => Promise<void>;
  }
}

const form = document.getElementById("join-form") as HTMLFormElement;
const statusLine = document.getElementById("status-line");
const nameInput = document.getElementById("display-name") as HTMLInputElement;
const roomInput = document.getElementById("room-code-input") as HTMLInputElement;

nameInput.value = storedName();

void init();

async function init(): Promise<void> {
  const session = await loadSession();
  if (!session) {
    redirectToLogin();
    return;
  }
  setRoomCode("—");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await joinExisting();
});

// Expose functions for inline onclick handlers.
window.hostRoom = hostRoom;
window.copyLastRoomCode = copyLastRoomCode;

async function hostRoom(): Promise<void> {
  const name = nameInput.value.trim();
  if (!name) {
    setStatus("Add your display name first.");
    nameInput.focus();
    return;
  }

  try {
    await ensureSession(name);
    const game = await api("/games", {
      method: "POST",
      body: JSON.stringify({ host: name }),
    });
    setRoomCode(game.id);
    setStatus(`Created game ${game.id}. Redirecting…`);
    window.location.href = `/game/${encodeURIComponent(game.id)}`;
  } catch (error) {
    setStatus(`Could not create game: ${(error as Error).message}`);
  }
}

async function joinExisting(): Promise<void> {
  const name = nameInput.value.trim();
  const code = roomInput.value.trim();
  if (!name || !code) {
    setStatus("Enter both a name and room code.");
    return;
  }

  try {
    await ensureSession(name);
    await api(`/games/${encodeURIComponent(code)}/lobby/join`, {
      method: "POST",
      body: JSON.stringify({ playerId: name }),
    });
    setRoomCode(code);
    setStatus(`Joined ${code}. Redirecting…`);
    window.location.href = `/game/${encodeURIComponent(code)}`;
  } catch (error) {
    setStatus(`Could not join: ${(error as Error).message}`);
  }
}

async function copyLastRoomCode(): Promise<void> {
  try {
    await copyRoomCode();
    setStatus("Copied last room code (after you join or host).");
  } catch (error) {
    setStatus((error as Error)?.message ?? "Clipboard not available.");
  }
}

function redirectToLogin(): void {
  const url = new URL("/login", window.location.origin);
  url.searchParams.set("next", window.location.pathname);
  window.location.replace(url.toString());
}

function setStatus(message: string): void {
  if (statusLine) statusLine.textContent = message;
}
