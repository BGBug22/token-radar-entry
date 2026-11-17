// Launch Radar — the value model for token-radar-01.
//
// A pre-token protocol's implied value is fitted from the snapshot's own
// traded tokens — but only the 92 that pass the board's own eligibility
// rule: one per ticker, no CEX, no bridge, no liquid-staking product, no
// version-marked name. The board itself excludes those tokens, so the
// curve is fitted on the population it ranks, not on a mix the board
// throws away. An OLS size curve on log10 market cap vs log10 TVL,
// shrunk per-category offsets, a small momentum term from the 7-day TVL
// change, and a record term for how long the protocol has run with no
// token. Nothing is hardcoded by name: every number below follows from
// the snapshot's figures.
//
//   implied = 10^a x TVL^b x Peers x Momentum x Record
//
// The farm plan prices a $1,000 deposit held 60 days: a 10% slice of the
// implied launch, pro rata, minus gas (4 transactions on the cheapest
// chain) and the $6.58 a 4% T-bill would have paid on the $1,000.
// FARM only when the net at HALF the implied value — the launch coming
// in at half what the curve says — still clears $10: the old $5-an-hour
// bar let 141 of 198 rows through, most of them one haircut from THIN.
// THIN when the point-estimate net is non-negative but below that bar;
// SKIP when the net is negative. The bridge that moves the $1,000 onto
// the cheapest chain is priced beside the plan, not inside it: where the
// money starts is the reader's, not the radar's, to know. Every step of
// the plan carries a calendar date: the deposit on the snapshot's date,
// weekly checks each Saturday, the withdrawal 60 days on.
//
// What the leave-one-out says about each factor (92 comps, full grid
// in analysis/ablation-grid.json): the 7-day change is mostly noise, so
// it carries a tenth of the weight v3 gave it (rank corr 0.401 -> 0.409,
// median miss x3.52 -> x3.46); the record floor rose 0.70 -> 0.85 and
// the peer shrinkage rose to 40 pseudo-peers (time-split miss x2.94 ->
// x2.72, within 3x 51% -> 53%). A median slope and a Huber fit were
// tested and did not beat OLS out of sample. Kin was tested and is not
// in the model: no pre-token protocol in the snapshot shares a name stem
// with a traded token (0 of 342), so the factor never fires.
//
// All of this is pure and deterministic: the same snapshot bytes give
// the same board bytes, every run. No network, no clock, no randomness
// except a seeded PRNG for the bootstrap.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export type Verdict = 'FARM' | 'THIN' | 'SKIP';

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  is_watchlist: boolean;
  is_early: boolean;
  days_no_token: number;
  base_usd: number;
  peers: number;
  momentum: number;
  record: number;
  p25_usd: number;
  p75_usd: number;
  slice_usd: number;
  gas_usd: number;
  gas_chain: string;
  gas_per_tx_usd: number;
  bridge_usd: number;
  net_usd: number;
  net_half_usd: number;
  net_after_bridge_usd: number;
  net_per_hour_usd: number;
  verdict: Verdict;
  break_even_odds: number;
}

export interface Fit {
  a: number;
  b: number;
  rSquared: number;
  peers: Record<string, number>;
  comps: Protocol[];
}

export interface Oos {
  loo: {
    medianMiss: number;
    within3: number;
    within10: number;
    rankCorr: number;
    flatMedianMiss: number;
    flatWithin3: number;
    flatWithin10: number;
    flatRankCorr: number;
    bandLo: number;
    bandHi: number;
  };
  timeSplit: {
    trainN: number;
    testN: number;
    medianMiss: number;
    within3: number;
    flatMedianMiss: number;
    rankCorr: number;
    flatRankCorr: number;
  };
  bootstrap: {
    rounds: number;
    seed: number;
    aMean: number;
    aSd: number;
    bMean: number;
    bSd: number;
  };
  /** The same checks on the board's own population: the 92 traded tokens that pass the board's exclusion rule. */
  eligible: {
    loo: {
      medianMiss: number;
      within3: number;
      rankCorr: number;
      flatMedianMiss: number;
      flatWithin3: number;
      flatRankCorr: number;
    };
    timeSplit: {
      trainN: number;
      testN: number;
      medianMiss: number;
      within3: number;
      flatMedianMiss: number;
      rankCorr: number;
      flatRankCorr: number;
    };
  };
  /** Expanding-window walk-forward: fit on tokens listed before each year, test on the next year's. */
  walkForward: {
    all: Walkforward;
    eligible: Walkforward;
  };
}

export interface WalkforwardFold {
  year: number;
  trainN: number;
  testN: number;
  medianMiss: number;
  within3: number;
  rankCorr: number;
}

export interface Walkforward {
  folds: WalkforwardFold[];
  pooledMedianMiss: number;
  pooledWithin3: number;
  pooledN: number;
  flatPooledMedianMiss: number;
}

// ---------------------------------------------------------------- constants

export const DEPOSIT_USD = 1000;
export const HOLD_DAYS = 60;
/** What $1,000 earns in a 4% T-bill over 60 days: 1000 x 0.04 x 60/365. */
export const OPP_COST_USD = 6.58;
/** Active hands-on hours across the 60-day hold (weekly 10-minute checks). */
export const ACTIVE_HOURS = 2;
/** A farm must clear this net when the launch comes in at half the implied value. */
export const FARM_NET_HALF_USD = 10;
/** The 7-day TVL change's weight in the momentum factor: a tenth. */
export const MOMENTUM_COEF = 0.1;
/** Pseudo-peers the category offsets are shrunk toward zero with. */
export const PSEUDO_PEERS = 40;
/** The record term reaches 1.00 after this many days with no token. */
export const RECORD_DAYS_CAP = 730;
/** The record term's floor for a protocol with no days on record. */
export const RECORD_MIN = 0.85;
/** Board rows: the watchlist plus the largest pre-token protocols below it. */
export const BOARD_MAX_ROWS = 198;
export const BOOTSTRAP_ROUNDS = 200;
export const BOOTSTRAP_SEED = 20261114;

/**
 * What one simple transaction costs, in whole dollars, on each chain
 * (November 2026 medians for an approve/deposit-class call). Everything
 * not named here costs the default: an L2, a sidechain or another
 * low-fee chain. The farm always prices the protocol's cheapest chain.
 */
export const GAS_TABLE: Record<string, number> = {
  Ethereum: 3.5,
  Bitcoin: 1.5,
  Solana: 0.01,
  Base: 0.01,
  Arbitrum: 0.05,
  Optimism: 0.05,
  Polygon: 0.01,
  Avalanche: 0.05,
  BSC: 0.03,
  zkSync: 0.05,
  Linea: 0.02,
};
export const GAS_DEFAULT_PER_TX = 0.05;
/** Four transactions make a farm: approve, deposit, withdraw, claim. */
export const GAS_TX_COUNT = 4;

/**
 * What bridging $1,000 of USDC onto a chain typically costs from
 * Ethereum (November 2026 medians, whole dollars). It is priced beside
 * the farm, not inside it: the plan counts the deposit arriving on the
 * cheapest chain, and the reader's starting chain is their own. An
 * unlisted chain costs the default.
 */
export const BRIDGE_TABLE: Record<string, number> = {
  Ethereum: 0,
  Solana: 1,
  Base: 3,
  Arbitrum: 3,
  Optimism: 3,
  Polygon: 1,
  Avalanche: 2,
  BSC: 1,
  zkSync: 3,
  Linea: 3,
};
export const BRIDGE_DEFAULT_USD = 3;

// ---------------------------------------------------------------- small tools

/** A seeded PRNG (mulberry32): the bootstrap's only source of randomness. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The median of a list (the average of the two middle values when even). */
export function median(values: number[]): number {
  const v = [...values].sort((x, y) => x - y);
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** A percentile by linear interpolation on the sorted list. */
export function percentile(values: number[], p: number): number {
  const v = [...values].sort((x, y) => x - y);
  if (v.length === 0) return Number.NaN;
  if (v.length === 1) return v[0]!;
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo]! + (v[hi]! - v[lo]!) * (idx - lo);
}

/** Spearman rank correlation, with average ranks for ties. */
export function spearman(xs: number[], ys: number[]): number {
  const ranks = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((i, j) => v[i]! - v[j]!);
    const r = new Array<number>(v.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && v[order[j + 1]!] === v[order[i]!]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k]!] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i]! - mx) * (ry[i]! - my);
    vx += (rx[i]! - mx) * (rx[i]! - mx);
    vy += (ry[i]! - my) * (ry[i]! - my);
  }
  return cov / Math.sqrt(vx * vy);
}

/** Whole dollars, rounded half away from zero like the board shows. */
export function wholeUsd(x: number): number {
  return Math.round(x);
}

// ---------------------------------------------------------------- snapshot rules

/** True when the snapshot records no token for the protocol. */
export function isNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = [
  'binance',
  'coinbase',
  'bybit',
  'kraken',
  'bitget',
  'okx',
  'bitfinex',
  'gemini',
];

/**
 * A name ends in a version marker when it ends in a space followed by a
 * version: a V-number (V2, v12) or a dotted number (2.0). A bare number
 * with no V and no dot, like "Project 0", is a name, not a version.
 */
export function hasVersionMarker(name: string): boolean {
  return /\s(?:[vV]\d+(?:\.\d+)*|\d+\.\d+)$/.test(name);
}

/**
 * The watchlist's own exclusion rule, as the snapshot's RULES.txt states
 * it: not a bridge, a liquid-staking product or an exchange, no version
 * marker in the name, no whole word wrapped, staked or staking, and not
 * named after an exchange. The house's list is read from the snapshot;
 * this rule is what the board uses for the protocols below the floor.
 */
export function isExcluded(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (hasVersionMarker(p.name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  const lower = p.name.toLowerCase();
  for (const ex of EXCHANGE_PREFIXES) {
    if (lower.startsWith(ex)) return true;
  }
  return false;
}

/** The fields the value factors read: a traded comp or a board row both carry them. */
export interface FactorInputs {
  change_7d: number | null;
  listed_at: string | null;
}

// ---------------------------------------------------------------- the fit

/** The traded comps: protocols whose market cap the snapshot records. */
export function tradedComps(protocols: Protocol[]): Protocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
}

/** The comps the board itself could have ranked: traded tokens that pass the board's exclusion rule. */
export function eligibleComps(comps: Protocol[]): Protocol[] {
  return comps.filter((p) => !isExcluded(p));
}

/** OLS on log10 market cap against log10 TVL. Returns a, b and R squared. */
export function olsFit(rows: Protocol[]): { a: number; b: number; rSquared: number } {
  const xs = rows.map((p) => Math.log10(p.tvl_usd));
  const ys = rows.map((p) => Math.log10(p.mcap_usd!));
  const n = rows.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    ssTot += (ys[i]! - my) * (ys[i]! - my);
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i]! - (a + b * xs[i]!);
    ssRes += r * r;
  }
  return { a, b, rSquared: 1 - ssRes / ssTot };
}

/**
 * Per-category offsets: each category's mean log residual, shrunk toward
 * zero with PSEUDO_PEERS pseudo-peers, as a multiplier. A category with
 * no comps gets no offset (a factor of 1).
 */
export function peerOffsets(
  rows: Protocol[],
  a: number,
  b: number,
): Record<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const p of rows) {
    const cat = p.category ?? 'Uncategorized';
    const r = Math.log10(p.mcap_usd!) - (a + b * Math.log10(p.tvl_usd));
    const cur = sums.get(cat) ?? { sum: 0, n: 0 };
    cur.sum += r;
    cur.n += 1;
    sums.set(cat, cur);
  }
  const out: Record<string, number> = {};
  for (const [cat, { sum, n }] of sums) {
    out[cat] = 10 ** (sum / (n + PSEUDO_PEERS));
  }
  return out;
}

/**
 * Fit the size curve and the peer offsets on the snapshot's eligible
 * comps only: the 92 traded tokens that pass the board's own exclusion
 * rule. Fitting on all 128 traded tokens mixes in CEX, bridge and
 * liquid-staking tokens the board itself throws away; the eligible-only
 * fit predicts the board's own population far better out of sample
 * (time split x1.90 against x2.59) at the same leave-one-out (x3.26
 * against x3.22), and the board barely moves (top 20 identical).
 */
export function fitModel(protocols: Protocol[]): Fit {
  const comps = eligibleComps(tradedComps(protocols));
  const { a, b, rSquared } = olsFit(comps);
  const peers = peerOffsets(comps, a, b);
  return { a, b, rSquared, peers, comps };
}

// ---------------------------------------------------------------- the factors

/** 1 + a tenth of the 7-day TVL change, clamped to [0.6, 1.4]. No change: 1. */
export function momentumFactor(p: FactorInputs): number {
  const change = p.change_7d === null ? 0 : p.change_7d / 100;
  return Math.min(1.4, Math.max(0.6, 1 + MOMENTUM_COEF * change));
}

/** Days the protocol has run with no token, to the snapshot's date. */
export function recordDays(p: FactorInputs, asOf: string): number {
  if (p.listed_at === null) return 365;
  const listed = new Date(p.listed_at + 'T00:00:00Z').getTime();
  const at = new Date(asOf + 'T00:00:00Z').getTime();
  const days = Math.floor((at - listed) / 86400000);
  return Math.max(0, days);
}

/** 0.85 rising linearly to 1.00 over RECORD_DAYS_CAP days with no token. */
export function recordFactor(p: FactorInputs, asOf: string): number {
  const days = recordDays(p, asOf);
  return RECORD_MIN + (1 - RECORD_MIN) * (Math.min(days, RECORD_DAYS_CAP) / RECORD_DAYS_CAP);
}

/** The size curve alone: 10^a x TVL^b. */
export function baseValue(tvlUsd: number, a: number, b: number): number {
  return 10 ** a * tvlUsd ** b;
}

/** The full implied value of one protocol under a fitted model. */
export function impliedValue(p: Protocol, fit: Fit, asOf: string): number {
  const peers = p.category !== null ? (fit.peers[p.category] ?? 1) : 1;
  return (
    baseValue(p.tvl_usd, fit.a, fit.b) *
    peers *
    momentumFactor(p) *
    recordFactor(p, asOf)
  );
}

// ---------------------------------------------------------------- the farm

/** The cheapest chain to farm on, and what one transaction costs there. */
export function cheapestChain(p: Protocol): { chain: string; perTx: number } {
  let best = p.chains[0] ?? 'Ethereum';
  let bestCost = GAS_TABLE[best] ?? GAS_DEFAULT_PER_TX;
  for (const c of p.chains) {
    const cost = GAS_TABLE[c] ?? GAS_DEFAULT_PER_TX;
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
    }
  }
  return { chain: best, perTx: bestCost };
}

export interface Farm {
  sliceUsd: number;
  gasUsd: number;
  gasChain: string;
  gasPerTxUsd: number;
  bridgeUsd: number;
  netUsd: number;
  netHalfUsd: number;
  netAfterBridgeUsd: number;
  netPerHourUsd: number;
  verdict: Verdict;
  breakEvenOdds: number;
}

/** What bridging $1,000 of USDC onto a chain typically costs from Ethereum. */
export function bridgeCost(chain: string): number {
  return BRIDGE_TABLE[chain] ?? BRIDGE_DEFAULT_USD;
}

/**
 * Price the $1,000, 60-day farm of one protocol at an implied value:
 * a 10% slice of the launch, pro rata, minus gas and the T-bill yield
 * the $1,000 gives up. The break-even odds are the launch chance at
 * which the plan pays for itself: costs divided by the slice. The bridge
 * onto the cheapest chain is priced beside the net, not inside it.
 */
export function farmFor(p: Protocol, impliedUsd: number): Farm {
  const sliceUsd = (0.1 * impliedUsd * DEPOSIT_USD) / p.tvl_usd;
  const { chain, perTx } = cheapestChain(p);
  const gasUsd = GAS_TX_COUNT * perTx;
  const bridgeUsd = bridgeCost(chain);
  const netUsd = sliceUsd - gasUsd - OPP_COST_USD;
  const netHalfUsd = sliceUsd / 2 - gasUsd - OPP_COST_USD;
  const netAfterBridgeUsd = netUsd - bridgeUsd;
  const netPerHourUsd = netUsd / ACTIVE_HOURS;
  const verdict: Verdict =
    netHalfUsd >= FARM_NET_HALF_USD ? 'FARM' : netUsd >= 0 ? 'THIN' : 'SKIP';
  const breakEvenOdds = sliceUsd > 0 ? Math.min(1, (gasUsd + OPP_COST_USD) / sliceUsd) : 1;
  return { sliceUsd, gasUsd, gasChain: chain, gasPerTxUsd: perTx, bridgeUsd, netUsd, netHalfUsd, netAfterBridgeUsd, netPerHourUsd, verdict, breakEvenOdds };
}

/** "14 Nov 2026": a calendar date, no time, no timezone tricks. */
export function fmtDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The date n days after an ISO date, at UTC midnight. */
export function addDays(iso: string, n: number): Date {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000);
}

/**
 * The five concrete steps of the farm, with this protocol's own numbers
 * and calendar dates: the deposit on the snapshot's date, a check every
 * Saturday (the snapshot fell on one), the withdrawal 60 days on.
 * Each step stays inside the 20–600 characters the rules allow.
 */
export function farmSteps(p: Protocol, farm: Farm, asOf: string): string[] {
  const money = (x: number): string => `$${x.toFixed(2)}`;
  const start = fmtDate(addDays(asOf, 0));
  const end = fmtDate(addDays(asOf, HOLD_DAYS));
  const checks = [7, 14, 21, 28, 35, 42, 49, 56]
    .map((n) => fmtDate(addDays(asOf, n)).replace(/ \d{4}$/, ''))
    .join(', ');
  return [
    `Move $1,000 in USDC to ${farm.gasChain} on ${start}, the cheapest chain ${p.name} runs on. Bridging it there from Ethereum costs about ${money(farm.bridgeUsd)} — counted beside the plan below, not inside it.`,
    `Approve USDC for ${p.name} on ${farm.gasChain} on ${start} — 1 transaction, about ${money(farm.gasPerTxUsd)} in gas at November 2026 prices.`,
    `Deposit the $1,000 into ${p.name} on ${farm.gasChain} on ${start} — 1 transaction, about ${money(farm.gasPerTxUsd)} in gas. This is the position that earns points if a token ever launches.`,
    `Hold until ${end} (60 days) and check the position every Saturday — ${checks} — about 10 minutes a week (2 hours of hands-on time in total). Leave early only if TVL falls 30% in a week.`,
    `Withdraw the $1,000 and claim any points on ${end} — 2 transactions, about ${money(2 * farm.gasPerTxUsd)} in gas. Total gas about ${money(farm.gasUsd)}, plus $6.58 of T-bill yield given up on the $1,000 for 60 days.`,
  ];
}

// ---------------------------------------------------------------- the board

export interface BoardBuild {
  rows: BoardRow[];
  setAside: number;
  earlyFinds: number;
  watchlistCovered: number;
  verdicts: Record<Verdict, number>;
}

/**
 * Build the board: the watchlist, plus the largest pre-token protocols
 * below the floor that pass the watchlist's exclusion rule, up to
 * BOARD_MAX_ROWS rows, ranked by implied value. Early finds are the
 * board's rows below the floor: the small protocols the radar exists
 * to find early. Everything else in the snapshot is set aside.
 */
export function buildBoard(
  snapshot: Snapshot,
  fit: Fit,
  bandLo: number,
  bandHi: number,
): BoardBuild {
  const watchlist = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter((p) => isNoToken(p) && !isExcluded(p));
  candidates.sort((x, y) => y.tvl_usd - x.tvl_usd);
  const chosen = candidates.slice(0, BOARD_MAX_ROWS);

  const rows: BoardRow[] = chosen.map((p) => {
    const implied = impliedValue(p, fit, snapshot.as_of);
    const farm = farmFor(p, implied);
    const days = recordDays(p, snapshot.as_of);
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: wholeUsd(implied),
      farm_steps: farmSteps(p, farm, snapshot.as_of),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      is_watchlist: watchlist.has(p.slug),
      is_early: p.tvl_usd < snapshot.floor_usd,
      days_no_token: days,
      base_usd: wholeUsd(baseValue(p.tvl_usd, fit.a, fit.b)),
      peers: p.category !== null ? (fit.peers[p.category] ?? 1) : 1,
      momentum: momentumFactor(p),
      record: recordFactor(p, snapshot.as_of),
      p25_usd: wholeUsd(implied * bandLo),
      p75_usd: wholeUsd(implied * bandHi),
      slice_usd: farm.sliceUsd,
      gas_usd: farm.gasUsd,
      gas_chain: farm.gasChain,
      gas_per_tx_usd: farm.gasPerTxUsd,
      bridge_usd: farm.bridgeUsd,
      net_usd: farm.netUsd,
      net_half_usd: farm.netHalfUsd,
      net_after_bridge_usd: farm.netAfterBridgeUsd,
      net_per_hour_usd: farm.netPerHourUsd,
      verdict: farm.verdict,
      break_even_odds: farm.breakEvenOdds,
    };
  });

  rows.sort((x, y) => {
    if (y.implied_value_usd !== x.implied_value_usd) return y.implied_value_usd - x.implied_value_usd;
    if (y.tvl_usd !== x.tvl_usd) return y.tvl_usd - x.tvl_usd;
    return x.slug < y.slug ? -1 : 1;
  });
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const verdicts: Record<Verdict, number> = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) verdicts[r.verdict]++;
  return {
    rows,
    setAside: snapshot.protocols.length - rows.length,
    earlyFinds: rows.filter((r) => r.is_early).length,
    watchlistCovered: rows.filter((r) => r.is_watchlist).length,
    verdicts,
  };
}

// ---------------------------------------------------------------- validation

function missRatio(pred: number, actual: number): number {
  return Math.max(pred / actual, actual / pred);
}

interface LooOutcome {
  medianMiss: number;
  within3: number;
  within10: number;
  rankCorr: number;
  flatMedianMiss: number;
  flatWithin3: number;
  flatWithin10: number;
  flatRankCorr: number;
  bandLo: number;
  bandHi: number;
}

/**
 * Leave-one-out: refit the curve and the peer offsets on the training
 * pool without each tested token in turn, predict it, and compare with
 * a flat multiple (the train set's median market-cap-to-TVL) as the
 * baseline. The band is the P25–P75 of the actual-over-predicted ratios.
 * The training pool is the fit's own: the eligible comps. The tested
 * set may be wider (all traded tokens) or the same pool.
 */
export function looValidation(
  trainPool: Protocol[],
  testSet: Protocol[],
  asOf: string,
): LooOutcome {
  const preds: number[] = [];
  const flats: number[] = [];
  const actual: number[] = [];
  for (let i = 0; i < testSet.length; i++) {
    const held = testSet[i]!;
    const train = trainPool.filter((p) => p !== held);
    const { a, b } = olsFit(train);
    const peers = peerOffsets(train, a, b);
    const peer = held.category !== null ? (peers[held.category] ?? 1) : 1;
    const pred =
      baseValue(held.tvl_usd, a, b) * peer * momentumFactor(held) * recordFactor(held, asOf);
    preds.push(pred);
    const multiples = train.map((p) => p.mcap_usd! / p.tvl_usd).sort((x, y) => x - y);
    const medMultiple = median(multiples);
    flats.push(held.tvl_usd * medMultiple);
    actual.push(held.mcap_usd!);
  }
  const misses = preds.map((p, i) => missRatio(p, actual[i]!));
  const flatMisses = flats.map((p, i) => missRatio(p, actual[i]!));
  const within = (arr: number[], k: number): number =>
    arr.filter((m) => m <= k).length / arr.length;
  const ratios = actual.map((a, i) => a / preds[i]!).sort((x, y) => x - y);
  return {
    medianMiss: median(misses),
    within3: within(misses, 3),
    within10: within(misses, 10),
    rankCorr: spearman(preds, actual),
    flatMedianMiss: median(flatMisses),
    flatWithin3: within(flatMisses, 3),
    flatWithin10: within(flatMisses, 10),
    flatRankCorr: spearman(flats, actual),
    bandLo: percentile(ratios, 0.25),
    bandHi: percentile(ratios, 0.75),
  };
}

/**
 * Time split: fit on the training pool's comps listed before 2024, test
 * on the tested set's tokens listed in 2024 or later. Comps with no
 * listing date take no part in either side.
 */
export function timeSplitValidation(
  trainPool: Protocol[],
  testSet: Protocol[],
  asOf: string,
): { trainN: number; testN: number; medianMiss: number; within3: number; flatMedianMiss: number; rankCorr: number; flatRankCorr: number } {
  const train = trainPool.filter((p) => p.listed_at !== null && p.listed_at < '2024-01-01');
  const test = testSet.filter((p) => p.listed_at !== null && p.listed_at >= '2024-01-01');
  const { a, b } = olsFit(train);
  const peers = peerOffsets(train, a, b);
  const multiples = train.map((p) => p.mcap_usd! / p.tvl_usd).sort((x, y) => x - y);
  const medMultiple = median(multiples);
  const misses: number[] = [];
  const flatMisses: number[] = [];
  const preds: number[] = [];
  const flats: number[] = [];
  const actual: number[] = [];
  for (const p of test) {
    const peer = p.category !== null ? (peers[p.category] ?? 1) : 1;
    const pred =
      baseValue(p.tvl_usd, a, b) * peer * momentumFactor(p) * recordFactor(p, asOf);
    preds.push(pred);
    flats.push(p.tvl_usd * medMultiple);
    actual.push(p.mcap_usd!);
    misses.push(missRatio(pred, p.mcap_usd!));
    flatMisses.push(missRatio(p.tvl_usd * medMultiple, p.mcap_usd!));
  }
  return {
    trainN: train.length,
    testN: test.length,
    medianMiss: median(misses),
    within3: misses.filter((m) => m <= 3).length / misses.length,
    flatMedianMiss: median(flatMisses),
    rankCorr: spearman(preds, actual),
    flatRankCorr: spearman(flats, actual),
  };
}

/** Bootstrap the fit: 200 resamples with replacement, seeded. */
export function bootstrapValidation(
  comps: Protocol[],
): { rounds: number; seed: number; aMean: number; aSd: number; bMean: number; bSd: number } {
  const rand = mulberry32(BOOTSTRAP_SEED);
  const aVals: number[] = [];
  const bVals: number[] = [];
  for (let r = 0; r < BOOTSTRAP_ROUNDS; r++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < comps.length; i++) {
      sample.push(comps[Math.floor(rand() * comps.length)]!);
    }
    const { a, b } = olsFit(sample);
    aVals.push(a);
    bVals.push(b);
  }
  const mean = (v: number[]): number => v.reduce((s, x) => s + x, 0) / v.length;
  const sd = (v: number[]): number => {
    const m = mean(v);
    return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length);
  };
  return {
    rounds: BOOTSTRAP_ROUNDS,
    seed: BOOTSTRAP_SEED,
    aMean: mean(aVals),
    aSd: sd(aVals),
    bMean: mean(bVals),
    bSd: sd(bVals),
  };
}

/**
 * The full out-of-sample validation of the fit. Every check trains on
 * the fit's own pool — the 92 eligible comps — and is scored twice:
 * once on all 128 traded tokens, once on the board's own population
 * (the 92 eligible tokens). The eligible rows are the ones that matter:
 * the curve is fitted on that population and ranks it.
 */
export function validateModel(allComps: Protocol[], asOf: string): Oos {
  const train = eligibleComps(allComps);
  const loo = looValidation(train, allComps, asOf);
  const timeSplit = timeSplitValidation(train, allComps, asOf);
  const bootstrap = bootstrapValidation(train);
  const eligible = {
    loo: looValidation(train, train, asOf),
    timeSplit: timeSplitValidation(train, train, asOf),
  };
  const walkForward = walkforwardValidation(train, allComps, asOf);
  return { loo, timeSplit, bootstrap, eligible, walkForward };
}

function walkforwardOn(
  trainPool: Protocol[],
  testSet: Protocol[],
  asOf: string,
): Walkforward {
  const folds: WalkforwardFold[] = [];
  const pooled: number[] = [];
  const flatPooled: number[] = [];
  for (const cut of ['2022-01-01', '2023-01-01', '2024-01-01']) {
    const year = Number(cut.slice(0, 4));
    const next = `${year + 1}-01-01`;
    const train = trainPool.filter((p) => p.listed_at !== null && p.listed_at < cut);
    const test = testSet.filter(
      (p) => p.listed_at !== null && p.listed_at >= cut && p.listed_at < next,
    );
    if (train.length < 10 || test.length < 3) continue;
    const { a, b } = olsFit(train);
    const peers = peerOffsets(train, a, b);
    const multiples = train.map((p) => p.mcap_usd! / p.tvl_usd).sort((x, y) => x - y);
    const medMultiple = median(multiples);
    const preds: number[] = [];
    const flats: number[] = [];
    const actual: number[] = [];
    for (const p of test) {
      const peer = p.category !== null ? (peers[p.category] ?? 1) : 1;
      preds.push(
        baseValue(p.tvl_usd, a, b) * peer * momentumFactor(p) * recordFactor(p, asOf),
      );
      flats.push(p.tvl_usd * medMultiple);
      actual.push(p.mcap_usd!);
    }
    const misses = preds.map((pr, i) => missRatio(pr, actual[i]!));
    folds.push({
      year,
      trainN: train.length,
      testN: test.length,
      medianMiss: median(misses),
      within3: misses.filter((m) => m <= 3).length / misses.length,
      rankCorr: spearman(preds, actual),
    });
    pooled.push(...misses);
    flatPooled.push(...flats.map((f, i) => missRatio(f, actual[i]!)));
  }
  return {
    folds,
    pooledMedianMiss: median(pooled),
    pooledWithin3: pooled.filter((m) => m <= 3).length / pooled.length,
    pooledN: pooled.length,
    flatPooledMedianMiss: median(flatPooled),
  };
}

/**
 * Walk-forward on both populations: fit on the training pool's tokens
 * listed before each year, test on the next year's, expanding window.
 * The eligible run tests on the eligible tokens only.
 */
export function walkforwardValidation(
  trainPool: Protocol[],
  allComps: Protocol[],
  asOf: string,
): { all: Walkforward; eligible: Walkforward } {
  return {
    all: walkforwardOn(trainPool, allComps, asOf),
    eligible: walkforwardOn(trainPool, eligibleComps(allComps), asOf),
  };
}

/**
 * Each board row's P5–P95 rank over the same 200 seeded bootstrap
 * refits as the bootstrap panel: resample the comps with replacement,
 * refit the curve and the peer offsets, re-rank the board, record.
 */
export function bootstrapRankRanges(
  rows: BoardRow[],
  comps: Protocol[],
  asOf: string,
): Array<[number, number]> {
  const rand = mulberry32(BOOTSTRAP_SEED);
  const ranks: number[][] = rows.map(() => []);
  for (let r = 0; r < BOOTSTRAP_ROUNDS; r++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < comps.length; i++) {
      sample.push(comps[Math.floor(rand() * comps.length)]!);
    }
    const { a, b } = olsFit(sample);
    const peers = peerOffsets(sample, a, b);
    const vals = rows.map((row) => {
      const peer = row.category !== null ? (peers[row.category] ?? 1) : 1;
      return (
        baseValue(row.tvl_usd, a, b) *
        peer *
        momentumFactor(row) *
        recordFactor(row, asOf)
      );
    });
    const order = rows.map((_, i) => i).sort((x, y) => {
      if (vals[y]! !== vals[x]!) return vals[y]! - vals[x]!;
      if (rows[y]!.tvl_usd !== rows[x]!.tvl_usd) return rows[y]!.tvl_usd - rows[x]!.tvl_usd;
      return rows[x]!.slug < rows[y]!.slug ? -1 : 1;
    });
    order.forEach((idx, pos) => {
      ranks[idx]!.push(pos + 1);
    });
  }
  return ranks.map((rs) => {
    const lo = Math.round(percentile(rs, 0.05));
    const hi = Math.round(percentile(rs, 0.95));
    return [lo, hi] as [number, number];
  });
}
