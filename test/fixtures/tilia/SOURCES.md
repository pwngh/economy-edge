# Tilia — sources

- Docs home: https://prod-tilia.redoc.ly/  (the old tilia.io URLs now redirect to
  thunes.com)
- Key pages under that base: `/docs/authentication/`, `/docs/headers/` (Idempotency-Key),
  `/docs/openapi/invoicing/operation/requestPayout/`, `/docs/openapi/invoicing/operation/getAllPayouts/`,
  `/docs/openapi/invoicing/operation/payoutComplete/` (webhook),
  `/docs/openapi/pii/operation/GetKYCStatus/`,
  `/docs/openapi/wallets/operation/GetBalancesByAccountID/`, `/docs/webhooks/`,
  `/docs/guides/request-payout/`, `/docs/web-uis/tilia-hosted-widget/`.

Each Redocly page embeds the full OpenAPI spec for its service (invoicing, pii, wallets),
so the fixtures follow spec-derived shapes rather than guesses.
