# Money in

The flow is three steps, two of them yours:

1. **`verify`** — the edge proves the purchase with the provider and performs the
   rail's claim step (Steam's finalize, Google's acknowledge) so an unclaimed
   purchase is never credited.
2. **Credit** — your ledger posts, idempotency-keyed by
   `purchase.providerTxnId`.
3. **`fulfill`** — where the rail has consumables (Meta, Google, PICO), mark the
   purchase consumed _after_ the credit committed.

## Handling the verify outcome

| Outcome             | Meaning                                                 | Do                                |
| ------------------- | ------------------------------------------------------- | --------------------------------- |
| `ok: true`          | proven and claimed                                      | credit, then fulfill              |
| `'REJECTED'`        | the provider said no                                    | decline; touch nothing            |
| `'RETRYABLE'`       | transient (network, rate limit, purchase still pending) | back off and retry the same proof |
| `'ALREADY_SETTLED'` | already refunded or reversed                            | refuse; nothing to credit         |

A malformed proof throws a `*.MALFORMED_PROOF` fault instead — that is a caller bug,
not a provider answer.

## Proof shapes

| Provider | `proof`                                                                        |
| -------- | ------------------------------------------------------------------------------ |
| `steam`  | `{ orderId }` — your order id from InitTxn, as a decimal string                |
| `meta`   | `{ userId, sku }`                                                              |
| `google` | `{ productId, purchaseToken }` — from the client purchase                      |
| `apple`  | `{ transactionId }` — from the StoreKit 2 transaction                          |
| `pico`   | `{ userAccessToken, userId, sku }` — the user token is relayed from the client |

## fulfill and status

`fulfill` takes the same proof and returns the same `Outcome` shape; a rail without a
consume step answers `CODEC.UNSUPPORTED`. If a fulfill fails after you credited,
retry on `'RETRYABLE'` and raise for review on `'REJECTED'` — do not un-credit
automatically.

`status({ provider, providerTxnId })` resolves one transaction to
`SETTLED | PENDING | FAILED | UNKNOWN`. Only Steam and Apple can answer it; the
others return `UNKNOWN` because their platforms offer no per-transaction query.
