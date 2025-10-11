# Prompt Guesser — Game Design Document v0.1

## Overview
**Prompt Guesser** is an online, turn-based party game for 4–6 players.  
The game is played across multiple rounds. In each round, one player (the **Prompt Giver**) secretly writes a text prompt used to generate an image.  
Other players (the **Guessers**) then try to deceive one another by writing fake prompts and later guessing which one was the real one.

At the end of the game, the player with the highest total score wins.

---

## 1. Roles
- **Prompt Giver** – the player who writes the real prompt that will be used to generate the image.  
- **Guessers** – all other players in the round. They submit fake prompts and later guess which one was real.

---

## 2. Game Setup
- 4–6 players recommended.  
- The game proceeds for a set number of rounds (typically equal to the number of players so everyone serves once as Prompt Giver).  
- Automatic timeouts ensure rounds progress even if a player is inactive.

---

## 3. Round Structure

Each round consists of five **steps**:

### Step 1 — Prompt Creation
- The **Prompt Giver** secretly writes a text prompt.
- This prompt will be used to generate an image.
- If the Prompt Giver fails to submit a prompt before the timer expires, the round is **skipped**.

### Step 2 — Image Generation
- The system generates an image based on the submitted prompt.
- Once complete, the image is shown to all players.

### Step 3 — Decoy Prompt Submission
- Each **Guesser** writes their own **Decoy Prompt** — a fake prompt that could plausibly have created the shown image.
- Submissions are secret.
- If a player does not submit before the timer expires, their entry is skipped.

### Step 4 — Guessing Phase
- The system shuffles together:
  - the **Real Prompt**, and  
  - all submitted **Decoy Prompts**.
- Each **Guesser** selects one prompt they believe to be the Real Prompt.
- The **Prompt Giver** does not vote.
- If a player fails to vote before the timer expires, their vote is ignored.

### Step 5 — Reveal and Scoring
- The system reveals which prompt was the Real Prompt.
- Votes are displayed.
- Points are awarded as follows:

| Event | Points | Recipient |
|--------|---------|------------|
| Correctly guessed the Real Prompt | +3 | Guesser |
| A Guesser selected your Decoy Prompt | +1 per vote | Guesser who wrote that Decoy |
| Real Prompt guessed by at least one but not all Guessers | +3 | Prompt Giver |
| All Guessers guessed correctly OR none guessed correctly | +0 | Prompt Giver |
| All Guessers guessed correctly or incorrectly | +2 each | All Guessers (as in Dixit rule balance) |

After scoring, the next player in order becomes the Prompt Giver.

---

## 4. Round Timing
- Each step has an automatic timer (e.g., 60 seconds for writing, 30 seconds for guessing).
- When the timer expires:
  - Missing submissions are ignored.
  - The game automatically progresses to the next step.
- Players cannot pause or delay the flow manually.

---

## 5. Game End and Victory
- The game continues for the chosen number of rounds.
- At the end, all players’ points are totaled.
- The player with the highest total score wins.
- If two or more players have the same highest score, they **share the victory**.

---

## 6. Edge Cases

| Situation | Resolution |
|------------|-------------|
| Prompt Giver timeout | Round skipped |
| Guesser timeout (prompt submission) | No decoy prompt submitted |
| Guesser timeout (voting) | No vote, 0 points |
| Image generation failure | Round skipped |
| Player disconnects | Treated as timeout; no action until reconnect |
| Fewer than 3 players remain | Game automatically ends |

---

## 7. Design Principles
- **Automatic progression:** The game never stalls due to player inactivity.  
- **Social contract prompts:** Prompt style and phrasing are decided by player norms; no enforcement in code.  
- **Unpredictability embraced:** Image generation randomness is part of the experience.  
- **Transparency:** All scoring and vote results are visible to players after each round.

---

**End of Document**

