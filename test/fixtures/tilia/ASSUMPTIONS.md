# Tilia — fixture notes

Tilia is the payout rail (PayPal out). Its docs embed a real OpenAPI spec, so the
`expected/` fixtures follow the spec's own shapes — stronger than pure guesswork, but
still provisional until captured from staging (which is sales-gated).

## Worth knowing

- Auth is client-credentials in exchange for a bearer token.
- Idempotency is a global `Idempotency-Key` header (a UUID4). The adapter derives a
  stable UUID from the caller's key, so retries are safe whether or not the payout
  endpoint actually honors the header.
- A payout is looked up by Tilia's own `payout_status_id`. There's no documented lookup
  by the caller's key, so an ambiguous submit is resolved by re-driving submit with the
  same key.
- Amounts are assumed to be minor units (cents) until a staging payout confirms it.

## The big unknowns (confirm in staging)

- Webhook authentication is completely undocumented — no signature scheme. `parse()`
  normalizes without verifying, so the host has to secure the route itself (a URL secret
  or an allowlist) and confirm settlement by status before moving money.
- Whose account id the payout path uses — the payee's or the integrator's.
- Fees aren't in the payout rows, so `report()` reports fee 0 / net = gross until a real
  settlement shows where the ~1.5% PayPal fee lands.

## Captured so far

- An invalid client returns HTTP 400 with an OAuth-style `{"error",...}` envelope, not
  Tilia's usual `{status, payload}` — `captured/token-invalid-client.json`.

Doc links are in `SOURCES.md`.
