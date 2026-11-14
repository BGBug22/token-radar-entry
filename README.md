# Token Radar — model radar-2

A token launch radar for the make.fun bounty `token-radar-01`.

It reads the sealed DefiLlama snapshot (`input/snapshot.json`), scores every pre-token
protocol with one transparent model, and writes a ranked board plus a static dashboard
a reader can use: the board, a detail view for every protocol, and filters. Two tools sit
on top of the board: a **Top movers** panel (the fastest-growing TVL among the rows the
filters show) and an **Export CSV** button that downloads exactly the rows on screen.

## The model (radar-2)

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.02 x min(max(chains - 1, 0), 5)) )
```

- **Base:** a launch priced at a quarter of TVL.
- **Growth:** seven-day TVL change, clamped and weighted by half.
- **Maturity:** age since first listing, 0.60 new to 1.00 after three years.
- **Breadth:** +2% per extra chain, capped at +10%.

Every factor is a number the snapshot itself carries; no protocol name is special-cased.
Protocols whose token already trades are set aside with their market cap, never mixed
into the ranking. A protocol on the board records no token in the snapshot; that is not
proof it has none, and nothing here predicts whether or when a token is issued.

## Run

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the
output directory. The program runs twice with identical bytes.

## Files

- `main.ts` — entrypoint: reads the snapshot, writes the board, the data and the dossier.
- `lib/model.ts` — the radar-2 model, the farm plans and the board gate. The model math
  lives in small named helpers (growth, maturity, breadth) and the farm wording in one
  category table, so the model and the dashboard read the same rule.
- `dashboard/` — the static page (index.html, app.css, app.js), no network. The page
  recomputes each row's implied value, shows a Top movers panel, and exports the shown
  rows as CSV.
- `vendor/makefun-board.ts` — the kit's dossier library, unchanged.
- `screenshots/` — board, detail and filtered views of the dashboard.
