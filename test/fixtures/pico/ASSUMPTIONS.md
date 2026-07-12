# PICO — fixture notes

The `expected/` fixtures trace to the literal examples in PICO's docs (which are a bit
rough — one example is even malformed JSON; the fixtures keep valid JSON). Provisional
until captured.

## Worth knowing

- Errors come back as HTTP 200 with a non-zero `code` in the body. Branch on `code`,
  never on HTTP status.
- The app credential is a literal string, `PICO|<app_id>|<app_secret>`. Some calls
  instead need a user access token minted in the client SDK and relayed through.
- There's no per-transaction receipt check — ownership is per (user, SKU). The only
  per-order id is `purchase_id` from the purchases list, and the amount comes from the
  caller's SKU catalog.
- No webhooks (poll only) and no settlement API (monthly email plus a dashboard).
- `grant_time` is in milliseconds.

## Confirm against a real app

- Refund and chargeback visibility — nothing is documented. For now, a purchase dropping
  off the list is the only signal.

## Captured so far

- An unauthorized call returns HTTP 200 with `{"code":10010,"em":"Not authorized."}` —
  `captured/error-not-authorized.json`.

Doc links are in `SOURCES.md`.
