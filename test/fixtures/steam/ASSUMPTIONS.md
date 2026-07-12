# Steam — fixture notes

The `expected/` fixtures use Steam's documented field lists with made-up values (the
docs show schemas and an XML-style example, not JSON samples). Provisional until captured.

## Worth knowing

- 64-bit numbers — order and transaction ids — come back as JSON strings, so parse ids
  as strings, never numbers.
- There are no webhooks. Purchases are confirmed with FinalizeTxn and QueryTxn; refunds
  and chargebacks are found by polling GetReport.
- FinalizeTxn is effectful — it completes the charge — so a lost response is genuinely
  ambiguous and has to be re-queried.
- Amounts are in minor units. Whether that holds for zero-decimal currencies (does ¥100
  arrive as `100` or `10000`?) is unconfirmed.
- The sandbox is the same interface at `ISteamMicroTxnSandbox` — swap one path segment.

## Confirm against the sandbox

- The real JSON failure envelope, and whether item amounts serialize as strings or
  numbers.
- GetReport row field casing.
- Handy: with the publisher key, `GetSupportedAPIList` returns method and parameter
  metadata for the publisher-only methods — a free way to settle most of these questions
  at once.

## Captured so far

- An invalid key returns HTTP 403 with an HTML body, not JSON —
  `captured/forbidden-invalid-key.html`.

Doc links are in `SOURCES.md`.
