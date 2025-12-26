import {
  ApiError,
  api,
  copyRoomCode,
  requireSessionOrRedirect,
  setRoomCode,
  storedName,
} from "./shared.js";

declare global {
  interface Window {
    copyRoom: () => Promise<void>;
  }
}

const statusLine = document.getElementById("status-line");
const playerList = document.getElementById("player-list");
const leaderLine = document.getElementById("leader");
const roundLabel = document.getElementById("round-label");
const phaseLabel = document.getElementById("phase-label");
const phaseTitle = document.getElementById("phase-title");
const phaseDescription = document.getElementById("phase-description");
const submissionsList = document.getElementById("submissions");
const phaseImage = document.getElementById("phase-image");
const timerCount = document.getElementById("timer-count");
const timerFill = document.getElementById("timer-fill");
const latencyLine = document.getElementById("latency");
const errorPanel = document.getElementById("error-panel");
const errorText = document.getElementById("error-text");
const backToLobby = document.getElementById("back-to-lobby");
const retryLoad = document.getElementById("retry-load");
let currentGameId: string | null = null;

init();

function init(): void {
  const id = getGameIdFromPath();
  if (!id) {
    window.location.replace("/lobby");
    return;
  }
  currentGameId = id;
  setRoomCode(id);
  void bootstrap(id);
  window.copyRoom = copyRoom;

  if (backToLobby) {
    backToLobby.addEventListener("click", () => {
      window.location.replace("/lobby");
    });
  }

  if (retryLoad) {
    retryLoad.addEventListener("click", () => {
      if (!currentGameId) return;
      void bootstrap(currentGameId);
    });
  }
}

async function bootstrap(gameId: string): Promise<void> {
  const session = await requireSessionOrRedirect(window.location.pathname);
  if (!session) return;
  hideError();

  try {
    const game = await api(`/games/${encodeURIComponent(gameId)}`);
    renderGame(game);
    hideError();
    setStatus(`Joined as ${session.playerName}.`);
  } catch (error) {
    const apiError = error as ApiError | Error;
    if (apiError instanceof ApiError) {
      const detail = apiError.body?.error?.message ?? apiError.message;
      if (apiError.status === 404) {
        showError(
          `Game not found (${apiError.status}). ${
            detail || "Check the room code and try again."
          }`,
        );
        return;
      }
      showError(`Could not load game (${apiError.status}): ${detail}`);
      return;
    }
    showError(`Could not load game: ${apiError.message}`);
  }
}

function renderGame(
  visible: { readonly lobby?: { readonly players?: readonly string[] } } | null,
): void {
  const players = visible?.lobby?.players ?? [];
  renderPlayers(players);
  renderPhase();
  renderTimer(0, 0);
}

function renderPlayers(players: readonly string[]): void {
  if (!playerList) return;
  playerList.innerHTML = "";
  if (players.length === 0) {
    const empty = document.createElement("li");
    empty.className = "player";
    empty.innerHTML = `
      <div>
        <div class="player__name">Waiting for players…</div>
        <div class="player__status">Share the room code to invite friends.</div>
      </div>
    `;
    playerList.appendChild(empty);
    if (leaderLine) leaderLine.textContent = "No players yet";
    return;
  }

  players
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach((player) => {
      const item = document.createElement("li");
      item.className = "player";
      const isYou = player === storedName();
      item.innerHTML = `
        <span aria-hidden="true">🔹</span>
        <div>
          <div class="player__name">${player}${isYou ? " (you)" : ""}</div>
          <div class="player__status">In lobby</div>
        </div>
        <strong>0 pts</strong>
      `;
      playerList.appendChild(item);
    });

  if (leaderLine) leaderLine.textContent = `${players[0]} · 0 pts`;
  if (roundLabel) roundLabel.textContent = "Round 1";
}

function renderPhase(): void {
  if (phaseLabel) phaseLabel.textContent = "Waiting";
  if (phaseTitle) phaseTitle.textContent = "Lobby";
  if (phaseDescription)
    phaseDescription.textContent = "Waiting for host to start a round.";
  if (phaseImage) {
    const tag = phaseImage.querySelector(".image-shell__tag");
    const placeholder = phaseImage.querySelector(".image-shell__placeholder");
    if (tag) tag.textContent = "Waiting";
    if (placeholder) placeholder.textContent = "No image yet. Stay tuned.";
  }
  if (submissionsList) {
    submissionsList.innerHTML = "";
    const empty = document.createElement("li");
    empty.className = "submission__placeholder";
    empty.textContent = "Submissions will appear here once the round starts.";
    submissionsList.appendChild(empty);
  }
}

function renderTimer(remaining: number, duration: number): void {
  const safeDuration = duration || 1;
  const ratio = Math.max(0, Math.min(remaining / safeDuration, 1));
  if (timerCount) timerCount.textContent = `${remaining}s`;
  if (timerFill) (timerFill as HTMLElement).style.transform = `scaleX(${ratio})`;
  if (latencyLine) latencyLine.textContent = "—";
}

function getGameIdFromPath(): string {
  const path = window.location.pathname;
  const parts = path.split("/").filter(Boolean);
  return parts[1] ?? "";
}

function setStatus(message: string): void {
  if (statusLine) statusLine.textContent = message;
}

function showError(message: string): void {
  setStatus(message);
  if (errorText) errorText.textContent = message;
  if (errorPanel) errorPanel.hidden = false;
}

function hideError(): void {
  if (errorPanel) errorPanel.hidden = true;
}

async function copyRoom(): Promise<void> {
  try {
    await copyRoomCode();
    setStatus("Room code copied.");
  } catch (error) {
    setStatus((error as Error)?.message ?? "Clipboard unavailable.");
  }
}
