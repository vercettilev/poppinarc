# The X trade strip

Buy/Sell under tradeable tweets, matched on the reader's own machine.

## Why the ticker map needs refreshing

`tickerMap.generated.ts` is a photograph, not a fact. Three things move
underneath it:

- **New tokens cross the threshold.** The mid and low cap tail turns over
  constantly; a map generated in August knows nothing about September.
- **Old ones fall below it.** Liquidity drains, pools go quiet.
- **The gate's verdict is time-varying.** Five rows the generator had just
  confirmed came back refused minutes later — §7 reads live liquidity, pool
  age and a sell-route probe, and correctly reports an unreadable upstream as
  a failure rather than guessing.

That last point is why the runtime check exists and why the map can never be
the authority: **the map names an asset, `by-mint` decides whether it may be
offered.** A chip whose asset cannot be described removes itself.

## Refreshing

```
npm run build:tickers
```

Takes about three minutes — the gate pass is deliberately paced (2 requests
at a time, 400ms apart). That pacing is not politeness, it is correctness: an
early version ran eight at a time and reported 303 of 311 tickers refused,
because Jupiter was rate-limiting the gate's own reads. A slow re-run of the
same sample put `lookup_failed` at zero and admissions at 24%.

**Review the diff.** This file points Buy. A ticker resolving to the wrong
mint is a Buy button aimed at somebody else's token.

Weekly is a sensible cadence. Monthly and the tail goes stale; daily and the
diff stops getting read, which is worse than stale.

## The two tiers

| tier | liquidity | what the chip does |
|---|---|---|
| deep | ≥ $150k | inline Buy: preset → confirm → done, price impact shown |
| thin | $25k–$150k | shows price and a `thin` mark; the button opens the card |

Under $25k nothing ships: §7 refuses it, so a chip could never complete.

The split is measured, not chosen by taste. A $25 buy costs 0.17% in price
impact above $200k liquidity and 0.84% median (2.14% worst) between $25k and
$60k. Nobody gets rugged by slippage — they just quietly receive $23 of token
for $25 and never learn why. The thin tier keeps the tail visible while
putting one more beat of attention in front of the trade.

## What matching does and does not do

Three tiers of signal, by how much intent the author put behind it:

1. **cashtag** — `$WIF`, linkified by X. Highest precision.
2. **dollar text** — `$WIF` typed plain.
3. **curated name** — "dogwifhat", "Tesla". A hand-kept allowlist, and
   deliberately NOT widened by the generated map: `$PENGU` is a claim about a
   ticker, `penguins` is a word in a sentence.

The name tier will never contain political names (`Trump`, `Melania`) or
ordinary words (`WOULD`, `CLOUD`, `GOAT`, and `sol`, which is Turkish for
"left"). Those reach an asset only through the author's own `$`.
