import {
  api,
  copyRoomCode,
  requireSessionOrRedirect,
  setRoomCode,
  storedName,
} from "./shared.js";

const roomCode = document.getElementById("room-code");
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

init();

function init(): void {
  const id = getGameIdFromPath();
  if (!id) {
    window.location.replace("/lobby");
    return;
  }
  setRoomCode(id);
  void bootstrap(id);
  // Expose copy helper for inline handler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, functional/immutable-data
  (window as any).copyRoom = copyRoom;
}

async function bootstrap(gameId: string): Promise<void> {
  const session = await requireSessionOrRedirect(window.location.pathname);
  if (!session) return;

  try {
    const game = await api(`/games/${encodeURIComponent(gameId)}`);
    renderGame(game);
    setStatus(`Joined as ${session.playerName}.`);
  } catch (error) {
    setStatus(`Could not load game: ${(error as Error).message}`);
  }
}

function renderGame(visible: { lobby?: { players?: string[] } } | null): void {
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

async function copyRoom(): Promise<void> {
  try {
    await copyRoomCode();
    setStatus("Room code copied.");
  } catch (error) {
    setStatus((error as Error)?.message ?? "Clipboard unavailable.");
  }
}
