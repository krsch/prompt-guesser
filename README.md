# Prompt Guesser

Prompt Guesser is an online, turn-based party game for 4–6 players where everyone tries to mislead their friends with clever text prompts. One player secretly writes the real prompt that generated an image while the rest submit decoys and later guess which prompt was genuine. Points are awarded for deceiving others and for spotting the truth, and the player with the highest score after several rounds wins.

## Project status

This repository currently captures the early domain model and design documentation for the game. The TypeScript sources in [`src/domain`](src/domain) define foundational types and ports, while the [`docs`](docs) folder contains the game design document, architectural notes, and future roadmap.

## Getting started

The project uses Node.js and TypeScript. To install dependencies, run:

```bash
npm install
```

TypeScript definition work can be compiled or type-checked with:

```bash
npx tsc --noEmit
```

(There are currently no automated tests or runtime scripts.)

## Contributing

1. Fork the repository and create a feature branch.
2. Install dependencies with `npm install`.
3. Implement your changes, adding or updating documentation as needed.
4. Run `npx tsc --noEmit` to ensure the TypeScript domain types remain valid.
5. Submit a pull request describing your changes and referencing any relevant design docs.

For more background on the game rules, UX goals, and planned architecture, explore the files in [`docs/`](docs/).
