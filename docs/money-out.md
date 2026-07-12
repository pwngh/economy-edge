# Money out

## submit

```ts
const result = await edge.outbound.submit({ key, payee, amount });
```

`key` is **your** idempotency key — the id of the payout intent (a saga id). Keep it
stable across every retry of the same intent and never reuse it for a different one.
The edge threads it into the provider's native idempotency field; it never mints a
key of its own.

| Result          | Meaning                                          | Do                                                                    |
| --------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| `ACCEPTED`      | the provider took it; carries a `ref`            | store the ref; settlement arrives later                               |
| `REJECTED`      | terminal no                                      | safe to compensate (release the reserve)                              |
| `INDETERMINATE` | the response was lost — money **may** have moved | re-drive `submit` later with the **same key**; never compensate blind |

Rate limiting and credential problems throw faults (`TILIA.RATE_LIMITED`,
`TILIA.AUTH_REJECTED`) rather than pretending to be provider answers.

## status and cancel

`status({ ref })` resolves a payout to
`SETTLED | RETURNED | FAILED | PENDING | UNKNOWN`. Refs are opaque — store them
verbatim. `status({ key })` is refused on Tilia (`TILIA.KEY_LOOKUP_UNVERIFIED`):
the platform documents no lookup by caller key, which is why the INDETERMINATE
protocol is re-drive-by-key.

`cancel(ref)` withdraws a payout before settlement; a cancel that raced settlement
comes back `'ALREADY_SETTLED'`.

## The payee gate

A payout needs a verified payee first:

```ts
const gate = await edge.outbound.payee.status({ userId });
// 'CLEARED' | 'PENDING' | 'BLOCKED' | 'NONE' — require CLEARED before submit
```

`payee.onboard` begins Tilia's documented
[hosted payout flow](https://prod-tilia.redoc.ly/docs/web-uis/tilia-hosted-widget/)
(TOS, then payment-method collection) and returns the hosted URL to send the user
to; redirecting back to your site requires a return-URL domain that Tilia support
has allowlisted. KYC results also arrive as `KYC_CLEARED` / `KYC_BLOCKED` events
through [webhooks](webhooks.md).

## Settlement and failure

The terminal answer arrives asynchronously, through `parse` (fast) and `report`
(authoritative): `SETTLED` → settle your saga; `FAILED` or `RETURNED` → reverse the
reserve promptly. Confirm a webhook-reported settlement with `status({ ref })` before
posting money if your route cannot authenticate the webhook origin.
