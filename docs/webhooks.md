# Webhooks

The recipe for a webhook route, in order:

```ts
import { verifySignature } from '@pwngh/economy-edge';
```

1. Capture the **raw** body string and headers into a
   `{ provider, headers, body }` object.
2. `await verifySignature(scheme, webhook)` — reject the request if false.
3. `edge.inbound.parse(webhook)` or `edge.outbound.parse(webhook)` — pure,
   synchronous, total: it never throws, and anything it cannot recognize comes back
   as an `Unrecognized` event carrying the raw payload.
4. Handle each event. Dead-letter `Unrecognized`; dedupe in your own inbox (use the
   event's `providerTxnId` / `ref` / your provider's event id).

## Verification schemes

Pass the scheme that matches how the rail authenticates:

| Scheme        | For                                                     | You supply                                                            |
| ------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `hmac-sha256` | shared-secret payload signatures                        | the secret and the header name                                        |
| `jws-x5c`     | Apple Server Notifications                              | the pinned root — Apple Root CA G3                                    |
| `oidc-jwt`    | Google's Pub/Sub push                                   | Google's JWKS keys (fetch and rotate them yourself), issuer, audience |
| `transport`   | rails that authenticate the connection, not the payload | nothing — it verifies nothing, on purpose                             |

Tilia documents no payload signature — delivery auth is an "Authentication Type"
chosen when the destination is registered in Tilia Tools, with `Passthrough` meaning
none — so its scheme is `transport`: harden the route (secret URL, allowlist) and
confirm settlements with `status({ ref })` before posting money. Its documented
envelope is `{ event_name, bucket_key, sent_at, message }` with no event id, and any
response of 400 or higher triggers Tilia's retry process
([webhooks](https://prod-tilia.redoc.ly/docs/webhooks/)).

Both cryptographic schemes fail closed. `oidc-jwt` allows five minutes of clock skew
on `exp` and honors `nbf` and `iat` when present — a non-numeric time claim is a
rejection, not a pass. `jws-x5c` enforces every certificate's validity period,
caps the chain at six certificates of at most 16 KB each, and rejects non-EC leaf
keys and any `alg` other than ES256/ES384 — including `none`.
