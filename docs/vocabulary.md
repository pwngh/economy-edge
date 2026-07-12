# The vocabulary

Every adapter normalizes to these types. They live in
[`src/canonical/`](../src/canonical) and are exported from the package root.

## Money

```ts
interface Money {
  readonly minor: bigint;
  readonly currency: string;
  readonly __brand: 'Amount';
}
```

`minor` is an exact count of the currency's smallest unit. Exponents follow ISO 4217:
USD has 2 (cents), JPY has 0, BHD has 3; codes the table doesn't know default to 2.
`add` and `subtract` throw on mixed currencies — that bug is refused at the boundary.

The brand makes a plain `{ minor, currency }` unassignable, so every amount is built by
`money(currency, minor)` or `moneyFromDecimal` and the rules here can't be bypassed;
`isMoney` narrows an unknown. The brand literal matches economy-lab's `Amount`, so a
lab amount passes into an edge call unchanged, while the reverse stays an explicit
conversion — edge money may carry currencies the lab doesn't ledger.

For storage and wire use, `encodeMoney` / `decodeMoney` round-trip a string form:
`"USD:12.34"`, `"JPY:1234"`, `"BHD:1.234"`. `currencyExponent(code)` is exported if
you need the exponent yourself.

## Outcome

```ts
type Outcome<T, E> = { ok: true; value: T } | { ok: false; reason: E };
```

A provider's "no" is a value, never an exception. Exceptions are reserved for faults
(below).

## CanonicalPurchase

What `verify` returns. `providerTxnId` is the provider's authoritative id — use it as
your idempotency key when crediting, and as the reconciliation join key.
`providerSku` is the provider-visible product; mapping it to meaning (how many
credits, which entitlement) is yours. `productType` says consumable-ness, never
coins-ness. `sourceRef` records provenance; `occurredAt` is ISO 8601.

## CanonicalSettlement

A row from a settlement pull: `gross`, `fee`, `net` (one currency), optional `fx`.
`granularity` is absent for per-transaction rows; `'sku-day'` marks aggregate rows
(Apple's ceiling) so you never join aggregates against transactions.

## Events

`parse` returns arrays of events. Inbound: `PURCHASE`, `REFUND`, `CHARGEBACK` (with
`amount` and `originTxnId` where the rail supplies them). Outbound: `SETTLED`,
`RETURNED`, `FAILED`, `REVERSED`, `KYC_CLEARED`, `KYC_BLOCKED` (with a `ref` naming
the payout). Anything unrecognizable becomes `Unrecognized` with the raw payload
attached — dead-letter it; it is never dropped.

## Faults

Every thrown error carries a stable `code` (for example `CODEC.UNSUPPORTED`,
`TILIA.RATE_LIMITED`), a `retryable` boolean, and a `detail` object. Branch on the
code, never the message.

Every event and record carries `schemaVersion`. Changes are additive within a major
version.
