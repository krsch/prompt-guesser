# Prompt Guesser

Prompt Guesser is an online, turn-based party game for 4–6 players where everyone tries to mislead their friends with clever text prompts. One player secretly writes the real prompt that generated an image while the rest submit decoys and later guess which prompt was genuine. Points are awarded for deceiving others and for spotting the truth, and the player with the highest score after several rounds wins.

## Project status

The codebase is now centered on the MVCC game core in [`src/mvcc`](src/mvcc) with a local backend in [`packages/backend-local`](packages/backend-local). Shared config/ports live in [`src/domain`](src/domain), and the [`docs`](docs) folder contains the design notes and migration plan.

## Getting started

The project uses Node.js 22, pnpm, and TypeScript. To install dependencies, run:

```bash
pnpm install
```

Run the full check suite (type-check, lint, format check, tests) with:

```bash
pnpm run ci
```

### Running tests

Automated tests are powered by [Vitest](https://vitest.dev/). Run the suite locally with:

```bash
pnpm test -- --run
```

For watch mode during development:

```bash
pnpm run test:watch
```

To generate a coverage report (text output plus HTML in `coverage/`):

```bash
pnpm run test:coverage
```

## Contributing

1. Fork the repository and create a feature branch.
2. Install dependencies with `pnpm install` (a `.nvmrc` file is included for easy Node.js 22 selection).
3. Implement your changes, adding or updating documentation as needed.
4. Run `pnpm run ci` to ensure type checks, formatting, lint, and tests pass.
5. Submit a pull request describing your changes and referencing any relevant design docs.

For more background on the game rules, UX goals, and planned architecture, explore the files in [`docs/`](docs/).
