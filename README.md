# economy-edge

The boundary between payment providers and your ledger.

Five inbound rails — Steam, Meta, Google Play, Apple, PICO — and one outbound
payout rail, Tilia, each speak their own API. economy-edge turns all of them into
one vocabulary: verify a purchase, submit a payout, parse a webhook, pull a
settlement report. The ledger behind it never learns any provider's API.

It's stateless — no money, no records, no connections. Zero runtime dependencies,
and only the cross-runtime web globals (`fetch`, `crypto.subtle`,
`DecompressionStream`), so the same code runs on Node, Bun, Deno, and Cloudflare
Workers.

## Usage

Each provider is a factory: give it config, get an adapter back. `compose` routes
each call to the right one. Nothing reads the environment — you pass every
credential in.

```ts
import { compose } from '@pwngh/economy-edge';
import { steam } from '@pwngh/economy-edge/providers/inbound/steam';
import { tilia } from '@pwngh/economy-edge/providers/outbound/tilia';

const edge = compose({
  inbound: [
    steam({ publisherWebApiKey, appId: 438100, environment: 'production' }),
  ],
  outbound: [
    tilia({
      environment: 'production',
      clientId,
      clientSecret /* + payee + webhook config */,
    }),
  ],
});
```

`compose` does no I/O, and there's nothing to close.

Not on npm yet — consume it from a checkout: run `npm run build`, then import the
compiled `dist/`.

## Documentation

Guides in [docs/](docs/README.md): getting started, the vocabulary, money in, money
out, webhooks, reconciliation, and a page per provider.

## License

MIT © Preston Neal — see [LICENSE.md](LICENSE.md).
