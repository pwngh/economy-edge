# Reconciliation

`report(window)` is the authoritative settlement feed; webhooks only accelerate it.
You can lose every webhook and stay correct via the pull — on the rails that have
one.

```ts
const settlements = await edge.inbound.report({ from, to }); // ISO 8601 bounds
const payoutReport = await edge.outbound.report({ from, to });
```

## Inbound

`inbound.report` merges every rail that has a pull and silently includes nothing
else: Steam (immediate), Google (per-transaction earnings, published monthly around
the 5th, window ≤ 12 months), Apple (published daily, window ≤ 31 days — only when
the `reports` team-key config is set).

Join per-transaction rows against your ledger on `providerTxnId`. Rows marked
`granularity: 'sku-day'` (Apple) are aggregates — compare them against your sums per
SKU per day instead of joining per transaction.

## Outbound

`outbound.report` returns Tilia's settled disbursements plus `walletBalance` — the
provider-side float. Two checks belong on your side:

- **Float integrity** — deposits minus confirmed disbursements should equal the
  reported balance.
- **Coverage** — the float should cover your open payout obligations.

The diff itself — what's missing, what drifted — is deliberately yours: the edge
supplies normalized facts with join keys, nothing more.
