# Launch Radar — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![make.fun · token-radar-01 · rank](https://make.fun/badge/token-radar-01/BGBug22/token-radar-entry/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![make.fun · token-radar-01 · reward](https://make.fun/badge/token-radar-01/BGBug22/token-radar-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for pre-token protocols: it ranks the protocols that have not
launched a token yet by their implied launch value, fitted from the
snapshot's own traded tokens, and prices a $1,000, 60-day farm of each
one — net of gas and of the T-bill yield the $1,000 gives up.

## The model

```
implied = 10^a × TVL^b × Peers × Momentum × Record × Kin
```

The size curve is an OLS fit on log10 market cap against log10 TVL over
the snapshot's 128 traded tokens (a ≈ 3.0247, b ≈ 0.5223, R² ≈ 0.19).
Peers are per-category offsets, shrunk toward zero with 20 pseudo-peers.
Momentum is 1 + half the 7-day TVL change, clamped to [0.6, 1.4].
Record rises from 0.70 to 1.00 over 730 days running with no token.
Kin halves the value when a sibling token already trades (no board row
hits it). Chain count was tested and is not in the model: it did not
improve the out-of-sample miss.

Out of sample, leave-one-out over the 128 comps: median miss ×3.52
against ×5.07 for a flat market-cap-to-TVL multiple; within 3× for 46%
of comps, within 10× for 77%. Time split (fit pre-2024, test newer):
median miss ×2.94 against ×5.20 flat. Each row's P25–P75 band is the
implied value times the leave-one-out residual band (×0.36–×4.70).

## The farm

Deposit $1,000, hold 60 days. The slice is 10% of the implied launch,
pro rata: 0.10 × implied × $1,000 / TVL. Costs are gas for 4 transactions
on the protocol's cheapest chain plus $6.58 of T-bill yield given up.
FARM when the net clears $5 an hour of the 2 active hours the plan
takes; THIN when the net is non-negative but below that; SKIP when the
net is negative.

## The board

198 rows: the 40-protocol watchlist plus the largest pre-token protocols
below the $50M floor that pass the watchlist's exclusion rule. 138 rows
are early finds below the floor; 560 protocols in the snapshot are set
aside. The dashboard re-runs the model for every row and checks the
values, the verdicts and the board's sha256 digest — the green badge at
the top says so only when all of that passes.

## Run it

```
node main.ts --input <snapshot.json> --output <dir>
```

Node 22, standard library only. The program runs twice with the same
bytes: the same snapshot gives the same board, every run.

Implied value is the radar's own claim, fitted from one snapshot — not a
forecast and not a promise that a token will launch. Real airdrops never
ask for a seed phrase, a private key, or money up front.
