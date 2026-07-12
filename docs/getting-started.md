# Getting started

## Install

The package is not yet published to npm. Consume it from a checkout:

```jsonc
// package.json
{ "dependencies": { "@pwngh/economy-edge": "file:../economy-edge" } }
```

Then build it once (consumers import the compiled `dist/`):

```bash
cd ../economy-edge && npm install && npm run build
```

Node ≥ 22.18 to build and test. At runtime the library needs only the
cross-runtime globals (`fetch`, `crypto.subtle`, `DecompressionStream`), so it also
runs on Bun, Deno, and Cloudflare Workers.

## Compose

Each provider is a factory that takes typed config and returns an adapter. `compose`
routes calls to the right adapter by provider tag. Nothing reads your environment;
you pass every credential in.

```ts
import { compose } from '@pwngh/economy-edge';
import { steam } from '@pwngh/economy-edge/providers/inbound/steam';
import { tilia } from '@pwngh/economy-edge/providers/outbound/tilia';

const edge = compose({
  inbound: [steam({ publisherWebApiKey, appId: 438100, environment: 'production' })],
  outbound: [
    tilia({
      environment: 'production',
      clientId,
      clientSecret,
      integratorAccountId,
      resolvePayee,
      webhookVerification,
    }),
  ],
});
```

`compose` performs no I/O and there is nothing to close — the codec holds no state.

## First verification

```ts
const outcome = await edge.inbound.verify({ provider: 'steam', proof: { orderId } });

if (outcome.ok) {
  outcome.value; // a CanonicalPurchase — credit your ledger, keyed by its providerTxnId
} else {
  outcome.reason; // 'REJECTED' | 'RETRYABLE' | 'ALREADY_SETTLED' — see Money in
}
```

Next: [Money in](money-in.md), [Money out](money-out.md), [Webhooks](webhooks.md).
