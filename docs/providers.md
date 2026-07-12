# Providers

Config shapes, verbatim. Every provider also accepts `fetch?: FetchLike` for
injection in tests and `requestTimeoutMs?: number` — each provider call is
abort-signalled after 30 seconds by default, surfacing as a retryable
`TRANSPORT.TIMED_OUT` fault instead of hanging the caller. `resolveSku` is your
catalog: the platforms marked with it return no price server-side, so the amount
comes from you. Each rail's evidence ledger
(`ASSUMPTIONS.md`) and doc links (`SOURCES.md`) live in
[`test/fixtures/<provider>/`](../test/fixtures).

## steam

```ts
steam({ publisherWebApiKey, appId, environment: 'production' | 'sandbox', productTypeOf? })
```

The sandbox is the same API under a different interface name. No webhooks exist —
poll `status` and pull `report`. 64-bit ids travel as strings; treat them as such.

## meta

```ts
meta({ appId, appSecret, resolveSku });
```

Verification proves current entitlement, not a specific transaction; the purchase id
comes from the purchases list, the per-order id in webhooks is `reporting_id`.
Finance reporting is dashboard-only, so there is no `report`.

## google

```ts
google({ packageName, serviceAccountEmail, serviceAccountPrivateKey, resolveSku,
         notificationAudience?, financialReportsBucket? })
```

`verify` acknowledges unacknowledged purchases (Google auto-refunds unclaimed ones
after three days). Set `financialReportsBucket` (your `pubsite_prod_rev_…` bucket)
to enable the per-transaction earnings `report`. Verify RTDN pushes with the
`oidc-jwt` scheme.

## apple

```ts
apple({ environment: 'production' | 'sandbox', bundleId, issuerId, keyId, privateKey,
        reports?: { issuerId, keyId, privateKey, vendorNumber } })
```

The `reports` block is a **different** key — an App Store Connect team key — and
enables the sales `report` (aggregate `sku-day` rows; Apple publishes nothing
per-transaction). Verify notifications with the `jws-x5c` scheme pinned to Apple
Root CA G3.

## pico

```ts
pico({ region: 'global' | 'china', appId, appSecret, resolveSku });
```

Poll-only platform: no webhooks, no reports. `verify` and `fulfill` need a user
access token relayed from the client. Errors arrive as HTTP 200 with a non-zero
`code` — already handled inside the adapter.

## tilia (outbound)

```ts
tilia({
  environment: 'production' | 'staging',
  clientId,
  clientSecret,
  integratorAccountId,
  resolvePayee,
  webhookVerification,
});
```

`resolvePayee` maps your user id to the Tilia account and payment-method ids —
that store is yours. `integratorAccountId` scopes `report` (disbursements + wallet
balance). Webhooks carry no documented signature: pass
`{ scheme: 'transport' }` and confirm settlements with `status({ ref })`. One call
refuses by design until staging verifies its shape: `status({ key })` — Tilia
documents no payout lookup by caller key.
