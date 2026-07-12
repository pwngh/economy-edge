# Fixtures

Each provider folder holds two kinds of fixture — the body of an API response or a
webhook:

- `expected/` — written by hand from the provider's public docs. Provisional. Good
  enough to build and test an adapter against, but not proof the adapter is right.
- `captured/` — the real bytes from a sandbox response or webhook. This is the real
  thing. A captured file wins over an `expected/` file of the same name automatically,
  so promoting one is just dropping the file in.

An adapter isn't trusted until its scenarios are captured, not just written from docs.
What each provider's docs said, and what still needs a real capture to confirm, lives in
its `ASSUMPTIONS.md`; the doc links are in `SOURCES.md`.

## A few rules

- Don't invent an `expected/` shape the docs don't show. If the docs are silent, note it
  in `ASSUMPTIONS.md` instead of guessing in a payload.
- Redact captures: swap real ids, tokens, emails, and names for stable placeholders
  (`usr-1`, `acct-redacted`), the same one everywhere in a file. Never commit secrets or
  real personal data.
- Name files by scenario, not endpoint (`payout-settled.json`) — same name in both
  folders. One file per scenario; a body that also needs headers gets a
  `<name>.headers.json`.
- Load fixtures through `test/support/fixtures.ts`, never a hand-built path.

Prettier skips this folder on purpose — reformatting captured bytes would change them.
