# Apple — fixture notes

The `expected/` fixtures are built from Apple's docs, which show fields but no full
examples — so every signed (JWS) fixture here is made up: real field names, fake
signatures and certificate chains. Nothing is trusted until we capture real sandbox
bytes.

## Worth knowing

- A transaction's `price` is in milliunits (dollars × 1000) with a `currency`. Apple
  says not to use it for revenue — the financial reports are the source of record.
- Transactions and notifications are signed JWS with an x5c certificate chain up to
  Apple Root CA G3. The adapter verifies with the `jws-x5c` scheme and the host passes
  Apple's root in; `parse()` only decodes.
- Sandbox sends each notification once, with no retries (production retries).

## Confirm against a real sandbox

- Real JWS bytes for a purchase and a test notification. These also let us prove the
  certificate-chain check against real Apple chains instead of our own self-signed ones.
- Per-endpoint rate limits.
- Sales/finance reports come back as gzipped TSV; the exact column names are guessed
  until we pull a real one.

## Captured so far

- An invalid JWT returns HTTP 401 with a plain-text body, not JSON —
  `captured/error-unauthenticated.txt`.

Doc links are in `SOURCES.md`.
