const roomCode = document.querySelector("[data-room-code]");
const joinForm = document.querySelector(".join-card");
const statusLine = document.querySelector("[data-status-line]");
const playerList = document.querySelector("[data-players]");
const leaderLine = document.querySelector("[data-leader]");
const roundLabel = document.querySelector("[data-round-label]");
const phaseLabel = document.querySelector("[data-phase-label]");
const phaseTitle = document.querySelector("[data-phase-title]");
const phaseDescription = document.querySelector("[data-phase-description]");
const submissionsList = document.querySelector("[data-submissions]");
const phaseImage = document.querySelector("[data-phase-image]");
const phaseDetails = document.querySelector("[data-phase-details]");
const timerCount = document.querySelector("[data-timer-count]");
const timerFill = document.querySelector("[data-timer-fill]");
const latencyLine = document.querySelector("[data-latency]");

const phases = [
  {
    id: "prompt",
    label: "Step 1 of 4",
    title: "Prompt creation",
    description:
      "The Prompt Giver writes the real prompt. Everyone else is waiting for the image to appear.",
    submissionsTitle: "Waiting for the real prompt…",
    statusTag: "Generating",
  },
  {
    id: "decoy",
    label: "Step 2 of 4",
    title: "Decoy prompts",
    description:
      "Guessers write decoys that could fool the table. Keep them short, vivid, and convincing.",
    submissionsTitle: "Decoy prompts arriving",
    statusTag: "Image ready",
  },
  {
    id: "guess",
    label: "Step 3 of 4",
    title: "Guess the real prompt",
    description:
      "Everyone votes for the prompt they think is real. The Prompt Giver sits out.",
    submissionsTitle: "Votes locked",
    statusTag: "Voting",
  },
  {
    id: "reveal",
    label: "Step 4 of 4",
    title: "Reveal & scoring",
    description: "See which prompt was real, who got fooled, and how the points landed.",
    submissionsTitle: "Votes and authors",
    statusTag: "Reveal",
  },
];

const mockPrompts = {
  prompt: "A watercolor robot sipping tea at a cozy ramen stall in the rain",
  decoys: [
    {
      text: "Retro-futuristic food court bathed in neon with steam everywhere",
      author: "Nova",
      votes: 2,
    },
    {
      text: "Chef cat plating noodles on a synthwave rooftop at night",
      author: "Indigo",
      votes: 0,
    },
    {
      text: "Stormy alley where a vending machine glows like a tiny sun",
      author: "Juno",
      votes: 3,
    },
    {
      text: "Crowded night market with umbrellas under paper lanterns",
      author: "Lux",
      votes: 1,
    },
  ],
};

const gameState = {
  round: 2,
  totalRounds: 5,
  timer: 45,
  timerDuration: 60,
  latency: 24,
  phaseIndex: 0,
  players: [
    { name: "Nova", score: 12, status: "Prompt giver" },
    { name: "Indigo", score: 11, status: "Voting" },
    { name: "Lux", score: 9, status: "Writing decoy" },
    { name: "Juno", score: 9, status: "Locked" },
    { name: "Rey", score: 7, status: "Typing" },
    { name: "Mia", score: 6, status: "Typing" },
  ],
};

const actionButtons = document.querySelectorAll("[data-action]");

const renderPlayers = () => {
  playerList.innerHTML = "";
  gameState.players
    .slice()
    .sort((a, b) => b.score - a.score)
    .forEach((player) => {
      const item = document.createElement("li");
      item.className = "player";
      item.innerHTML = `
        <span aria-hidden="true">🔹</span>
        <div>
          <div class="player__name">${player.name}</div>
          <div class="player__status">${player.status}</div>
        </div>
        <strong>${player.score} pts</strong>
      `;
      playerList.appendChild(item);
    });

  const leader = gameState.players.slice().sort((a, b) => b.score - a.score)[0];
  leaderLine.textContent = `${leader.name} · ${leader.score} pts`;
  roundLabel.textContent = `Round ${gameState.round} of ${gameState.totalRounds}`;
};

const renderSubmissions = (phase) => {
  submissionsList.innerHTML = "";

  const entries = [
    { text: mockPrompts.prompt, author: "Prompt Giver", votes: 0 },
    ...mockPrompts.decoys,
  ];

  entries.forEach((entry, index) => {
    const item = document.createElement("li");
    const id = `prompt-${index + 1}`;
    item.innerHTML = `
      <div>
        <div class="submission__title">${entry.text}</div>
        <div class="meta">${entry.author}</div>
      </div>
      <span class="badge">${phase.id === "guess" || phase.id === "reveal" ? `${entry.votes} votes` : "Live"}</span>
    `;
    if (phase.id === "reveal" && index === 0) {
      item.dataset.truth = "true";
      item.querySelector(".submission__title").innerHTML =
        `<strong>${entry.text}</strong>`;
      item.querySelector(".meta").textContent = "Real prompt";
    }
    item.setAttribute("id", id);
    submissionsList.appendChild(item);
  });

  phaseDetails.querySelector("h3").textContent = phase.submissionsTitle;
};

const renderPhase = () => {
  const phase = phases[gameState.phaseIndex];
  phaseLabel.textContent = phase.label;
  phaseTitle.textContent = phase.title;
  phaseDescription.textContent = phase.description;

  const shellTag = phaseImage.querySelector(".image-shell__tag");
  shellTag.textContent = phase.statusTag;
  phaseImage.querySelector(".image-shell__placeholder").textContent =
    phase.id === "reveal"
      ? "Votes in! Tap a prompt to see who fell for it."
      : "Live preview ready for phones and tablets.";

  renderSubmissions(phase);
};

const renderTimer = () => {
  const remaining = Math.max(0, Math.min(gameState.timer, gameState.timerDuration));
  const ratio = remaining / gameState.timerDuration;
  timerCount.textContent = `${remaining}s`;
  timerFill.style.transform = `scaleX(${ratio})`;
};

const renderLatency = () => {
  latencyLine.textContent = `${gameState.latency} ms`;
};

const handleAdvance = () => {
  gameState.phaseIndex = (gameState.phaseIndex + 1) % phases.length;
  gameState.timer = 45;
  renderPhase();
  renderTimer();
};

const handleShuffle = () => {
  mockPrompts.decoys.sort(() => Math.random() - 0.5);
  renderSubmissions(phases[gameState.phaseIndex]);
};

const handleCopyCode = async () => {
  const code = roomCode.textContent;
  if (!code || !navigator.clipboard) {
    statusLine.textContent = "Clipboard not available on this device yet.";
    return;
  }
  await navigator.clipboard.writeText(code);
  statusLine.textContent = "Room code copied. Share it with your group!";
};

const handleHost = () => {
  statusLine.textContent = "Hosting locally — share the code and wait for players.";
};

const handleSaveName = () => {
  const input = joinForm.querySelector('input[name="display-name"]');
  if (!input.value) {
    statusLine.textContent = "Add your display name first.";
    input.focus();
    return;
  }
  localStorage.setItem("prompt-guesser:player-name", input.value);
  statusLine.textContent = `Saved ${input.value}. We will reuse it on this device.`;
};

const handleJoinSubmit = (event) => {
  event.preventDefault();
  const data = new FormData(joinForm);
  const name = data.get("display-name")?.toString().trim();
  const code = data.get("room-code")?.toString().trim().toUpperCase();

  if (!name || !code) {
    statusLine.textContent = "Please enter both a name and room code.";
    return;
  }

  localStorage.setItem("prompt-guesser:player-name", name);
  statusLine.textContent = `Joining ${code} as ${name}…`;
  roomCode.textContent = code;
};

const attachActions = () => {
  const handlers = {
    advance: handleAdvance,
    shuffle: handleShuffle,
    "copy-code": handleCopyCode,
    host: handleHost,
    "save-name": handleSaveName,
  };

  actionButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      const action = event.currentTarget.dataset.action;
      const handler = handlers[action];
      if (handler) handler();
    });
  });
};

const hydrateName = () => {
  const stored = localStorage.getItem("prompt-guesser:player-name");
  if (stored) {
    joinForm.querySelector('input[name="display-name"]').value = stored;
    statusLine.textContent = `Welcome back, ${stored}.`;
  }
};

const startTimerTick = () => {
  setInterval(() => {
    if (gameState.timer > 0) {
      gameState.timer -= 1;
      renderTimer();
    }
  }, 1000);
};

const init = () => {
  renderPlayers();
  renderPhase();
  renderTimer();
  renderLatency();
  attachActions();
  hydrateName();
  startTimerTick();

  joinForm.addEventListener("submit", handleJoinSubmit);
};

init();
