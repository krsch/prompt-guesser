# Prompt Guesser — Future Improvements & Optional Features (Companion to v0.1)

This document collects design ideas, enhancements, and open questions for future versions of _Prompt Guesser_.  
All items are non-binding; inclusion does not imply commitment to implement.

---

## 1. Gameplay Enhancements

### 1.1 Prompt Fairness & Similarity

- Add automated detection of overly similar decoy prompts.
- Use semantic similarity (embeddings) or text rules to prevent near-duplicates.
- Provide warnings or request resubmission when prompts are too close.

### 1.2 Mid-Game Joining

- Allow new players to join an ongoing game.
- Options:
  - Join as “spectator” until the next game.
  - Join mid-round but score from that point onward.

### 1.3 Difficulty & Themes

- Introduce thematic categories (e.g., “fantasy,” “sci-fi,” “nature”).
- Optionally provide a random theme for each round.
- Add a “difficulty mode” that adjusts prompt complexity or time limits.

### 1.4 Multiple Images per Round

- The Prompt Giver’s prompt could generate multiple images.
- Guessers must identify which image matches the prompt.
- Adds variety and reduces the effect of generation randomness.

### 1.5 Hint or Challenge Systems

- “Hint Token” mechanic: Prompt Giver may reveal a subtle clue at a cost.
- “Challenge Vote”: Guessers can dispute a prompt that seems invalid.

---

## 2. Scoring & Balance

- Experiment with alternative scoring tables.
- Adjust point ratios based on player count.
- Award creative or humorous bonus points (manual or voted).
- Introduce temporary multipliers for streaks or perfect rounds.
- Add optional “majority bonus” — extra points for voting with most others.

---

## 3. Timing & Flow

- Configurable timer durations per phase.
- “Ready” button: advance early when all players are done.
- Pause or resume rounds manually (for private lobbies).
- Host settings for turn order, number of rounds, and image regeneration.

---

## 4. Multiplayer & Social Features

- Public and private lobbies.
- Lobby chat or emoji reactions.
- Player profile icons or names displayed under votes.
- Post-round “highlight” or “most convincing decoy” awards.
- Optional spectator mode for streamers or tournaments.

---

## 5. Technical & UX Enhancements

- Preload or cache generated images to reduce waiting.
- Allow Prompt Giver to regenerate the image once if unsatisfactory.
- Display AI-generated text caption for accessibility.
- Provide text-only mode for screen reader users.
- Mobile-friendly voting layout and responsive design.
- Implement reconnect logic for disconnected players.

---

## 6. Tournament / Ranked Play

- Enforce stricter rules for prompt length and format.
- Validate prompts automatically before acceptance.
- Add matchmaking by skill or rating.
- Maintain persistent player statistics and leaderboards.
- Allow replay export or sharing of round histories.

---

## 7. Experimental & Creative Modes

- **Collaborative Mode:** Players collectively refine one evolving image.
- **Solo Challenge Mode:** One player faces AI-generated decoys.
- **AI Participant Mode:** The system contributes one decoy prompt automatically.
- **Custom Deck Mode:** Players predefine prompt lists or themes.

---

## 8. Administration & Moderation

- In-game reporting or “vote to kick” system.
- Language and content filters beyond model-level filtering.
- Host permissions: adjust rules, pause, restart.
- Safe-for-streaming toggle (restrict explicit content).

---

## 9. Potential Future Terms & Theming

- Re-theme roles for different aesthetics (e.g., _Dreamer / Observers_, _Artist / Critics_).
- Add visual themes (gallery, dreamscape, sci-fi lab).
- Offer seasonal or community prompt packs.

---

**End of Future Improvements Document**
