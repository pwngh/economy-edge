# Google Play — fixture notes

The `expected/` fixtures come from Google's docs — the real-time notification (RTDN)
samples are the docs' own examples; the purchase responses use the documented fields
with made-up values. The adapter's field shapes were also checked against Google's public
Discovery document, so they're solid; real captures still ratify them.

## Worth knowing

- A purchase response carries no price or currency — the amount has to come from the
  caller's SKU catalog. (Same as Meta and PICO.)
- Acknowledge a purchase within 3 days or Google auto-refunds and revokes it; consuming
  counts as acknowledging.
- Notifications arrive as Pub/Sub push messages signed with a Google OIDC token; the
  adapter verifies with the `oidc-jwt` scheme and host-supplied Google keys.
- Refunds are found by polling the Voided Purchases API (a hard 30-day window), not
  pushed.
- Financial reports are a monthly CSV zip in a Cloud Storage bucket, not an API.

## Confirm against a real app

- Whether missing fields come back absent or null.
- The real earnings-report column names (matched case-insensitively for now).
- Pub/Sub redelivery timing.

## Captured so far

- A malformed auth assertion returns HTTP 400 with `{"error":"invalid_request",...}` —
  `captured/token-invalid-assertion.json`.

Doc links are in `SOURCES.md`.
