# Meta (Horizon/Quest) — fixture notes

The `expected/` fixtures come from Meta's docs. The verify-entitlement success is the
docs' literal example; the rest mirror the documented shapes with made-up values.
Provisional until captured from a real dev app.

## Worth knowing

- The app access token is a literal string, `OC|<app_id>|<app_secret>`, sent as a
  request parameter — no token exchange.
- `verify_entitlement` proves a user currently owns a SKU. It returns no transaction id
  and no amount, so the transaction id has to come from `viewer_purchases` or the
  webhook, and the amount from the caller's SKU catalog.
- Webhooks are `order_status` events; `reporting_id` is the per-order id used to dedupe
  and join.
- Financial reporting is dashboard-only (monthly CSV) — no API.

## Confirm against a dev app

- The failure shapes for verify and double-consume. Don't hard-code an error code —
  treat anything that isn't success as not verified.
- Whether webhooks are signed (the Facebook `X-Hub-Signature-256` convention is likely
  but undocumented here) and their retry behavior.

## Captured so far

- An invalid app token returns HTTP 400 with a Graph error envelope (`OAuthException`,
  code 190) — `captured/error-invalid-app-token.json`.

Doc links are in `SOURCES.md`.
