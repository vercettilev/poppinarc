# Poppin on Arc

Poppin puts a Buy button under the posts people are already reading. Someone writes about $BTC on X, and a small chip under the post shows the price; one tap buys it with a dollar balance. This edition runs on Arc, Circle's Layer 1, where the balance is USDC and every account is a Circle wallet.

## Circle in this codebase

| Product | Where | What it does here |
|---|---|---|
| Circle Wallets (developer-controlled) | `api/src/circle/wallets.ts` | Every account is a Circle wallet on Arc, opened at sign-in. Circle holds the keys; this service holds wallet ids and never a private key. |
| App Kit Swap | `api/src/routers/circle-swap.router.ts`, `api/src/circle/kit.ts` | Buys and sells between USDC, EURC and cirBTC from the user's wallet. |
| App Kit Bridge on CCTP V2 | `api/src/deposits/deposits.service.ts` | USDC that arrives on another network moves to the user's Arc wallet with Fast Transfer and the Forwarding Service. |
| USDC | `api/src/arc/network.ts`, `api/src/arc/chain.ts` | The balance, and the gas every transaction pays. |
| EURC | `api/src/arc/network.ts`, `api/src/routers/circle-swap.router.ts` | A euro balance, and a way to pay in euros. |
| cirBTC | `api/src/market/market.service.ts` | `$BTC` on X resolves to Circle's Bitcoin on Arc. |

Every other Arc token (launchpad tokens and the rest of the long tail) routes through the KyberSwap aggregator in `api/src/routers/kyber.router.ts`, executed from the same Circle wallet. Before any of them gets a Buy button it has to pass a live check in `api/src/market/`: a real sell route, a small round-trip loss and real USDC depth.

## Layout

```
api/        the service the extension talks to (NestJS, Postgres, Circle SDKs)
extension/  the Poppin Chrome extension; `npm run build` produces the Arc edition
packages/   the asset catalog the extension matches posts against
```

## Run it

The API:

```
cd api
npm ci
npm test
```

It reads `ARC_NETWORK` (`testnet` or `mainnet`), `DATABASE_URL`, `CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET`. A testnet key on mainnet, or the reverse, is refused at boot.

The extension:

```
cd extension
npm ci
npm run build
```

Load `extension/dist` from `chrome://extensions` with Load unpacked. It installs next to the store version of Poppin under its own name, Poppin Arc.

## Status

Running on Arc testnet. Mainnet follows.
