# Repository-wide instructions

## CI-equivalent test command

Run the same checks that CI executes by running:

```
pnpm run ci
```

This script performs both TypeScript builds (main code and tests), checks formatting, runs lint, and executes the coverage tests. Use it before submitting any changes.
