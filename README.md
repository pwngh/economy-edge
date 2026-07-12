# economy-edge

The boundary between external payment providers and a ledger. Five inbound rails
(Steam, Meta, Google Play, Apple, PICO) and one outbound payout rail (Tilia)
each speak their own dialect; this package translates all of them into one
canonical vocabulary — verifying purchases, submitting payouts, parsing webhooks,
and pulling settlement reports — so the ledger behind it never learns any provider's
API.

The package is stateless: it holds no money, no records, and no connections. It has
zero runtime dependencies and uses only the cross-runtime web globals (`fetch`,
`crypto.subtle`, `DecompressionStream`), so it runs on Node, Bun, Deno, and
Cloudflare Workers alike. It is not yet published to npm — consume it from a
checkout after `npm run build`; consumers import the compiled `dist/`.

## Documentation

Consumer guides live in [docs/](docs/README.md): getting started, the canonical
vocabulary, money in, money out, webhooks, reconciliation, and per-provider
reference.

## License

MIT © Preston Neal — see [LICENSE.md](LICENSE.md).
