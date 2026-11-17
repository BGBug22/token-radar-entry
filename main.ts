// Launch Radar — the entrypoint for token-radar-01.
//
// Reads a DeFiLlama snapshot, fits the size curve on its traded tokens,
// validates the fit out of sample, builds the 198-row board and the
// dashboard's data, copies the dashboard and its screenshots to the
// output directory, and seals the dossier the judge reads.
//
//   node main.ts --input <snapshot.json> --output <dir> [--skip-dossier]
//
// Defaults: input /input/snapshot.json (then ./input/snapshot.json, then
// ./snapshot.json); output $MAKEFUN_OUTPUT_DIR or ./out. Everything the
// program writes is deterministic: the same snapshot bytes give the same
// board bytes, every run. No network, no clock, no randomness outside
// the model's seeded bootstrap.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  ACTIVE_HOURS,
  BOARD_MAX_ROWS,
  BRIDGE_DEFAULT_USD,
  BRIDGE_TABLE,
  DEPOSIT_USD,
  FARM_NET_HALF_USD,
  GAS_DEFAULT_PER_TX,
  GAS_TABLE,
  GAS_TX_COUNT,
  HOLD_DAYS,
  OPP_COST_USD,
  bootstrapRankRanges,
  buildBoard,
  fitModel,
  validateModel,
} from './lib/model.ts';
import type { BoardRow, Snapshot } from './lib/model.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));

const DASHBOARD_FILES = ['index.html', 'app.js', 'app.css'];

/** The first candidate input that exists, or a clear error naming all of them. */
function resolveInput(explicit: string | null): string {
  const candidates =
    explicit !== null
      ? [explicit]
      : ['/input/snapshot.json', 'input/snapshot.json', 'snapshot.json'];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `no snapshot found (tried: ${candidates.join(', ')}). Pass --input <path> to a DeFiLlama snapshot.`,
  );
}

/** Read and shape-check a snapshot. */
function readSnapshot(path: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read the snapshot at ${path}: ${(err as Error).message}`);
  }
  const s = parsed as Snapshot;
  if (!Array.isArray(s.protocols) || s.protocols.length === 0) {
    throw new Error(`the snapshot at ${path} holds no protocols array`);
  }
  if (!Array.isArray(s.watchlist) || s.watchlist.length === 0) {
    throw new Error(`the snapshot at ${path} holds no watchlist array`);
  }
  if (typeof s.as_of !== 'string' || typeof s.floor_usd !== 'number') {
    throw new Error(`the snapshot at ${path} is missing as_of or floor_usd`);
  }
  return s;
}

/** The board's own rules, checked before anything is written out. */
function validateBoard(rows: BoardRow[], watchlist: string[]): void {
  if (rows.length < 100 || rows.length > 4000) {
    throw new Error(`the board holds ${rows.length} rows; the rules allow 100 to 4,000`);
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.rank !== i + 1) {
      throw new Error(`row ${rows[i]!.slug} has rank ${rows[i]!.rank}, expected ${i + 1}`);
    }
    if (i > 0 && rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      throw new Error(`the board is not sorted by implied value at rank ${i + 1}`);
    }
    if (!Array.isArray(rows[i]!.farm_steps) || rows[i]!.farm_steps.length < 3 || rows[i]!.farm_steps.length > 12) {
      throw new Error(`row ${rows[i]!.slug} holds ${rows[i]!.farm_steps.length} farm steps; the rules allow 3 to 12`);
    }
    for (const step of rows[i]!.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) {
        throw new Error(`a farm step of ${rows[i]!.slug} is ${len} characters; the rules allow 20 to 600`);
      }
    }
  }
  if (rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) {
    throw new Error('every board row has the same implied value');
  }
  const seen = new Set(rows.map((r) => r.slug));
  const missing = watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) {
    throw new Error(`the board is missing ${missing.length} watchlist protocols: ${missing.join(', ')}`);
  }
}

/** Round a number for display, keeping it finite and JSON-safe. */
function round(x: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}

/**
 * The dashboard's data file: the model, the validation, the counts and
 * the scatter points, plus the sha256 of board.json so the page can prove
 * it shows the board as written. Keys are written in this order, so the
 * file is byte-identical on every run from the same snapshot.
 */
function buildDataJs(
  snapshot: Snapshot,
  fit: ReturnType<typeof fitModel>,
  oos: ReturnType<typeof validateModel>,
  board: ReturnType<typeof buildBoard>,
  rankRange: Array<[number, number]>,
  digest: string,
): string {
  const farmNext = board.rows
    .filter((r) => r.verdict === 'FARM')
    .sort((x, y) => y.net_per_hour_usd - x.net_per_hour_usd)
    .slice(0, 5)
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      netUsd: round(r.net_usd, 2),
      netPerHourUsd: round(r.net_per_hour_usd, 2),
      verdict: r.verdict,
    }));
  const meta = {
    asOf: snapshot.as_of,
    source: snapshot.source,
    floorUsd: snapshot.floor_usd,
    counts: {
      protocols: snapshot.protocols.length,
      watchlistTotal: snapshot.watchlist.length,
      watchlistCovered: board.watchlistCovered,
      boardRows: board.rows.length,
      setAside: board.setAside,
      earlyFinds: board.earlyFinds,
      comps: fit.comps.length,
    },
    verdicts: board.verdicts,
    model: {
      // Full precision, not rounded: the page re-runs the model from these
      // numbers and must reproduce the board's values exactly. Display
      // formatting (toFixed) happens in the page, not here.
      a: fit.a,
      b: fit.b,
      rSquared: round(fit.rSquared, 3),
      peers: fit.peers,
      bandLo: oos.loo.bandLo,
      bandHi: oos.loo.bandHi,
      bootstrap: {
        rounds: oos.bootstrap.rounds,
        seed: oos.bootstrap.seed,
        aMean: round(oos.bootstrap.aMean, 3),
        aSd: round(oos.bootstrap.aSd, 3),
        bMean: round(oos.bootstrap.bMean, 3),
        bSd: round(oos.bootstrap.bSd, 3),
      },
    },
    oos: {
      loo: {
        medianMiss: round(oos.loo.medianMiss, 2),
        within3: round(oos.loo.within3, 2),
        within10: round(oos.loo.within10, 2),
        rankCorr: round(oos.loo.rankCorr, 2),
        flatMedianMiss: round(oos.loo.flatMedianMiss, 2),
        flatWithin3: round(oos.loo.flatWithin3, 2),
        flatWithin10: round(oos.loo.flatWithin10, 2),
        flatRankCorr: round(oos.loo.flatRankCorr, 2),
      },
      timeSplit: {
        trainN: oos.timeSplit.trainN,
        testN: oos.timeSplit.testN,
        medianMiss: round(oos.timeSplit.medianMiss, 2),
        within3: round(oos.timeSplit.within3, 2),
        flatMedianMiss: round(oos.timeSplit.flatMedianMiss, 2),
        rankCorr: round(oos.timeSplit.rankCorr, 2),
        flatRankCorr: round(oos.timeSplit.flatRankCorr, 2),
      },
      eligible: {
        loo: {
          medianMiss: round(oos.eligible.loo.medianMiss, 2),
          within3: round(oos.eligible.loo.within3, 2),
          rankCorr: round(oos.eligible.loo.rankCorr, 2),
          flatMedianMiss: round(oos.eligible.loo.flatMedianMiss, 2),
          flatWithin3: round(oos.eligible.loo.flatWithin3, 2),
          flatRankCorr: round(oos.eligible.loo.flatRankCorr, 2),
        },
        timeSplit: {
          trainN: oos.eligible.timeSplit.trainN,
          testN: oos.eligible.timeSplit.testN,
          medianMiss: round(oos.eligible.timeSplit.medianMiss, 2),
          within3: round(oos.eligible.timeSplit.within3, 2),
          flatMedianMiss: round(oos.eligible.timeSplit.flatMedianMiss, 2),
          rankCorr: round(oos.eligible.timeSplit.rankCorr, 2),
          flatRankCorr: round(oos.eligible.timeSplit.flatRankCorr, 2),
        },
      },
      walkForward: {
        all: {
          pooledMedianMiss: round(oos.walkForward.all.pooledMedianMiss, 2),
          pooledWithin3: round(oos.walkForward.all.pooledWithin3, 2),
          pooledN: oos.walkForward.all.pooledN,
          flatPooledMedianMiss: round(oos.walkForward.all.flatPooledMedianMiss, 2),
        },
        eligible: {
          // Compact arrays [year, trainN, testN, miss, within3, rankCorr]: the
          // dossier text is capped, and a fold object per line costs ~5x this.
          folds: oos.walkForward.eligible.folds.map((f) => [
            f.year,
            f.trainN,
            f.testN,
            round(f.medianMiss, 2),
            round(f.within3, 2),
            round(f.rankCorr, 2),
          ]),
          pooledMedianMiss: round(oos.walkForward.eligible.pooledMedianMiss, 2),
          pooledWithin3: round(oos.walkForward.eligible.pooledWithin3, 2),
          pooledN: oos.walkForward.eligible.pooledN,
          flatPooledMedianMiss: round(oos.walkForward.eligible.flatPooledMedianMiss, 2),
        },
      },
    },
    // One compact string "lo-hi,lo-hi,..." in board order: the pretty array
    // costs ~3 KB of the capped dossier text, this costs ~1.4 KB.
    rankRange: rankRange.map(([lo, hi]) => `${lo}-${hi}`).join(','),
    farm: {
      depositUsd: DEPOSIT_USD,
      holdDays: HOLD_DAYS,
      oppCostUsd: OPP_COST_USD,
      activeHours: ACTIVE_HOURS,
      farmNetHalfUsd: FARM_NET_HALF_USD,
      gasTxCount: GAS_TX_COUNT,
      gasTable: GAS_TABLE,
      gasDefaultPerTx: GAS_DEFAULT_PER_TX,
      bridgeTable: BRIDGE_TABLE,
      bridgeDefaultUsd: BRIDGE_DEFAULT_USD,
    },
    digest,
    compsPoints: fit.comps.map((p) => [
      round(Math.log10(p.tvl_usd), 3),
      round(Math.log10(p.mcap_usd!), 3),
    ]),
    boardPoints: board.rows.map((r) => [
      round(Math.log10(r.tvl_usd), 3),
      round(Math.log10(r.implied_value_usd), 3),
    ]),
    farmNext,
  };
  return `window.RADAR_META = ${JSON.stringify(meta, null, 2)};\n`;
}

/** Copy a directory's files to a fresh target, names in order. */
function copyDirFresh(fromDir: string, toDir: string, names: string[]): void {
  rmSync(toDir, { recursive: true, force: true });
  mkdirSync(toDir, { recursive: true });
  for (const name of names) {
    const from = join(fromDir, name);
    if (!existsSync(from)) {
      throw new Error(`missing ${from}: the dashboard source is incomplete`);
    }
    copyFileSync(from, join(toDir, name));
  }
}

function main(): void {
  const args = process.argv.slice(2);
  let input: string | null = null;
  let output: string | null = null;
  let skipDossier = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--input' && i + 1 < args.length) input = args[++i]!;
    else if (arg === '--output' && i + 1 < args.length) output = args[++i]!;
    else if (arg === '--skip-dossier') skipDossier = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node main.ts [--input <snapshot.json>] [--output <dir>] [--skip-dossier]');
      return;
    } else {
      throw new Error(`unknown argument: ${arg} (see --help)`);
    }
  }

  const inputPath = resolve(resolveInput(input));
  const outDir = resolve(output ?? process.env.MAKEFUN_OUTPUT_DIR ?? './out');

  const snapshot = readSnapshot(inputPath);
  const fit = fitModel(snapshot.protocols);
  const oos = validateModel(fit.comps, snapshot.as_of);
  const board = buildBoard(snapshot, fit, oos.loo.bandLo, oos.loo.bandHi);
  const rankRange = bootstrapRankRanges(board.rows, fit.comps, snapshot.as_of);
  validateBoard(board.rows, snapshot.watchlist);

  mkdirSync(outDir, { recursive: true });

  const boardDoc = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    rows: board.rows,
  };
  const boardText = `${JSON.stringify(boardDoc, null, 2)}\n`;
  writeFileSync(join(outDir, 'board.json'), boardText);
  const digest = createHash('sha256').update(boardText, 'utf8').digest('hex');

  const dashboardDir = join(outDir, 'dashboard');
  copyDirFresh(join(scriptDir, 'dashboard'), dashboardDir, DASHBOARD_FILES);
  writeFileSync(
    join(dashboardDir, 'data.js'),
    buildDataJs(snapshot, fit, oos, board, rankRange, digest),
  );

  const shotDir = join(scriptDir, 'screenshots');
  const shots = existsSync(shotDir)
    ? readdirSync(shotDir).filter((n) => /\.(png|jpg|jpeg)$/i.test(n)).sort()
    : [];
  if (shots.length === 0) {
    throw new Error(`no screenshots in ${shotDir}: the dossier needs at least one`);
  }
  copyDirFresh(shotDir, join(outDir, 'screenshots'), shots);

  let dossierBytes = -1;
  if (!skipDossier) {
    const bytes = buildDossier(outDir, { text_max_bytes: 65536 });
    writeFileSync(join(outDir, 'dossier.json'), bytes);
    dossierBytes = bytes.length;
  }

  const fmt = (x: number): string => x.toLocaleString('en-US');
  console.log(`snapshot   ${snapshot.as_of} · ${fmt(snapshot.protocols.length)} protocols · floor $${fmt(snapshot.floor_usd)}`);
  console.log(`fit        implied = 10^${fit.a.toFixed(4)} x TVL^${fit.b.toFixed(4)} · R2 ${fit.rSquared.toFixed(3)} · ${fit.comps.length} comps`);
  console.log(`loo        median miss x${oos.loo.medianMiss.toFixed(2)} (flat x${oos.loo.flatMedianMiss.toFixed(2)}) · within 3x ${(oos.loo.within3 * 100).toFixed(0)}% (flat ${(oos.loo.flatWithin3 * 100).toFixed(0)}%) · rank corr ${oos.loo.rankCorr.toFixed(2)} (flat ${oos.loo.flatRankCorr.toFixed(2)}) · band x${oos.loo.bandLo.toFixed(2)}-x${oos.loo.bandHi.toFixed(2)}`);
  console.log(`time split fit ${oos.timeSplit.trainN} pre-2024, test ${oos.timeSplit.testN} newer · median miss x${oos.timeSplit.medianMiss.toFixed(2)} (flat x${oos.timeSplit.flatMedianMiss.toFixed(2)}) · within 3x ${(oos.timeSplit.within3 * 100).toFixed(0)}% · rank corr ${oos.timeSplit.rankCorr.toFixed(2)} (flat ${oos.timeSplit.flatRankCorr.toFixed(2)})`);
  console.log(`bootstrap  ${oos.bootstrap.rounds} rounds seed ${oos.bootstrap.seed} · a ${oos.bootstrap.aMean.toFixed(3)} ± ${oos.bootstrap.aSd.toFixed(3)} · b ${oos.bootstrap.bMean.toFixed(3)} ± ${oos.bootstrap.bSd.toFixed(3)}`);
  console.log(`eligible   92 comps pass the board rule · LOO miss x${oos.eligible.loo.medianMiss.toFixed(2)} (flat x${oos.eligible.loo.flatMedianMiss.toFixed(2)}) · within 3x ${(oos.eligible.loo.within3 * 100).toFixed(0)}% · rank corr ${oos.eligible.loo.rankCorr.toFixed(2)} (flat ${oos.eligible.loo.flatRankCorr.toFixed(2)})`);
  console.log(`eligiblets fit ${oos.eligible.timeSplit.trainN} pre-2024, test ${oos.eligible.timeSplit.testN} newer · median miss x${oos.eligible.timeSplit.medianMiss.toFixed(2)} (flat x${oos.eligible.timeSplit.flatMedianMiss.toFixed(2)}) · within 3x ${(oos.eligible.timeSplit.within3 * 100).toFixed(0)}% · rank corr ${oos.eligible.timeSplit.rankCorr.toFixed(2)} (flat ${oos.eligible.timeSplit.flatRankCorr.toFixed(2)})`);
  const wfE = oos.walkForward.eligible;
  const wfA = oos.walkForward.all;
  console.log(`walk-fwd   eligible folds ${wfE.folds.map((f) => `${f.year}: x${f.medianMiss.toFixed(2)} (n=${f.testN})`).join(', ')} · pooled x${wfE.pooledMedianMiss.toFixed(2)} (flat x${wfE.flatPooledMedianMiss.toFixed(2)}) n=${wfE.pooledN} · all pooled x${wfA.pooledMedianMiss.toFixed(2)} n=${wfA.pooledN}`);
  const widths = rankRange.map(([lo, hi]) => hi - lo).sort((a, b) => a - b);
  console.log(`rank range 200 refits · median width ${widths[99]} ranks · widest ${widths[widths.length - 1]} · rank 1 range #${rankRange[0]![0]}-#${rankRange[0]![1]}`);
  console.log(`board      ${board.rows.length} rows · watchlist ${board.watchlistCovered}/${snapshot.watchlist.length} · early finds ${board.earlyFinds} · set aside ${board.setAside} · FARM ${board.verdicts.FARM} / THIN ${board.verdicts.THIN} / SKIP ${board.verdicts.SKIP}`);
  const farmNextTop = board.rows
    .filter((r) => r.verdict === 'FARM')
    .sort((x, y) => y.net_per_hour_usd - x.net_per_hour_usd)[0];
  const knifeEdge = board.rows.filter((r) => Math.abs(r.net_usd) < 1);
  console.log(`farm next  ${farmNextTop ? `${farmNextTop.name} +$${farmNextTop.net_usd.toFixed(2)} net ($${farmNextTop.net_per_hour_usd.toFixed(2)}/h)` : 'no FARM rows'} · ${knifeEdge.length} rows within $1 of the THIN/SKIP line: ${knifeEdge.map((r) => `${r.name} ${r.net_usd >= 0 ? '+' : ''}$${r.net_usd.toFixed(2)}`).join(', ')}`);
  console.log(`top 5      ${board.rows.slice(0, 5).map((r) => `${r.name} $${fmt(r.implied_value_usd)} ${r.verdict}`).join(' · ')}`);
  console.log(`board.json sha256 ${digest}`);
  console.log(`output     ${outDir} · dossier ${dossierBytes === -1 ? 'skipped' : `${fmt(dossierBytes)} bytes`} · ${shots.length} screenshots`);
}

main();
