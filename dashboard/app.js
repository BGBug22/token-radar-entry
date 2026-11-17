// Launch Radar — the page logic.
//
// The page fetches ../board.json and proves it shows the board as written:
// it re-runs the model (the same formulas, in the same order, from the
// full-precision parameters in data.js) for every row, checks the implied
// value and the farm verdict against the board, and recomputes the sha256
// of the board text against the digest data.js carries. The badge at the
// top says so only when all of that passes.
//
// The page never talks to the network for anything else: no external
// links, no trackers, no fonts. The board is the page.

'use strict';

const META = window.RADAR_META;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------------- formatting

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** $90.1M, $1.2B, $845K, $12,300 — the board's compact money. */
function fmtUsd(x) {
  const abs = Math.abs(x);
  if (abs >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  return `$${Math.round(x).toLocaleString('en-US')}`;
}

/** Signed money with cents: +$65.35, -$3.34. */
function fmtMoney(x) {
  const sign = x < 0 ? '-' : '+';
  return `${sign}$${Math.abs(x).toFixed(2)}`;
}

/** A 7-day TVL change in percent, or an em dash when unrecorded. */
function fmtChange(change7d) {
  if (change7d === null || change7d === undefined) return '—';
  const sign = change7d > 0 ? '+' : '';
  return `${sign}${change7d.toFixed(1)}%`;
}

/** Days with no token: "169 d" under a year, "1.5y" at a year or more. */
function fmtDays(days) {
  if (days < 365) return `${days} d`;
  return `${(days / 365).toFixed(1)}y`;
}

/** A multiplier: x1.09, x0.74. */
function fmtFactor(x) {
  return `×${x.toFixed(2)}`;
}

function verdictClass(v) {
  return v === 'FARM' ? 'v-farm' : v === 'THIN' ? 'v-thin' : 'v-skip';
}

// ---------------------------------------------------------------- the model, again

// The same formulas as lib/model.ts, in the same order, from the
// full-precision parameters in data.js — so the recompute below must
// reproduce the board's values exactly. If it does not, the badge says so.

const GAS = META.farm.gasTable;
const GAS_DEFAULT = META.farm.gasDefaultPerTx;
const BRIDGE = META.farm.bridgeTable;
const BRIDGE_DEFAULT = META.farm.bridgeDefaultUsd;

function momentumFactor(change7d) {
  const change = change7d === null || change7d === undefined ? 0 : change7d / 100;
  return Math.min(1.4, Math.max(0.6, 1 + 0.1 * change));
}

function recordDays(listedAt) {
  if (listedAt === null || listedAt === undefined) return 365;
  const listed = new Date(`${listedAt}T00:00:00Z`).getTime();
  const at = new Date(`${META.asOf}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor((at - listed) / 86400000));
}

function recordFactor(listedAt) {
  const days = recordDays(listedAt);
  return 0.85 + 0.15 * (Math.min(days, 730) / 730);
}

function cheapestChain(chains) {
  let best = chains[0] ?? 'Ethereum';
  let bestCost = GAS[best] ?? GAS_DEFAULT;
  for (const c of chains) {
    const cost = GAS[c] ?? GAS_DEFAULT;
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
    }
  }
  return { chain: best, perTx: bestCost };
}

function recompute(row) {
  const peers = row.category !== null ? (META.model.peers[row.category] ?? 1) : 1;
  const implied =
    10 ** META.model.a *
    row.tvl_usd ** META.model.b *
    peers *
    momentumFactor(row.change_7d) *
    recordFactor(row.listed_at);
  const slice = (0.1 * implied * META.farm.depositUsd) / row.tvl_usd;
  const { chain, perTx } = cheapestChain(row.chains);
  const gas = META.farm.gasTxCount * perTx;
  const bridge = BRIDGE[chain] ?? BRIDGE_DEFAULT;
  const net = slice - gas - META.farm.oppCostUsd;
  const netAfterBridge = net - bridge;
  const netH = net / META.farm.activeHours;
  const verdict = netH >= 5 ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP';
  return { implied, peers, slice, gas, gasChain: chain, perTx, bridge, net, netAfterBridge, netH, verdict };
}

// ---------------------------------------------------------------- state

let rows = [];
let sortKey = 'rank';
let sortDir = 1;

function sortedRows(list) {
  const v = {
    rank: (r) => r.rank,
    name: (r) => r.name.toLowerCase(),
    tvl: (r) => r.tvl_usd,
    change: (r) => (r.change_7d === null ? -Infinity : r.change_7d),
    days: (r) => r.days_no_token,
    implied: (r) => r.implied_value_usd,
    slice: (r) => r.slice_usd,
    net: (r) => r.net_usd,
    neth: (r) => r.net_per_hour_usd,
    verdict: (r) => ({ FARM: 0, THIN: 1, SKIP: 2 })[r.verdict],
  }[sortKey];
  return [...list].sort((a, b) => {
    const x = v(a);
    const y = v(b);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return c * sortDir || a.rank - b.rank;
  });
}

function filteredRows() {
  const q = $('#f-search').value.trim().toLowerCase();
  const cat = $('#f-category').value;
  const chain = $('#f-chain').value;
  const tier = $('#f-tier').value;
  const verdict = $('#f-verdict').value;
  return rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (tier === 'watchlist' && !r.is_watchlist) return false;
    if (tier === 'early' && !r.is_early) return false;
    if (verdict && r.verdict !== verdict) return false;
    return true;
  });
}

// ---------------------------------------------------------------- rendering

let barLo = 0;
let barHi = 0;

function impliedCell(r) {
  const lo = Math.log10(Math.max(1, r.p25_usd));
  const hi = Math.log10(Math.max(1, r.p75_usd));
  const mid = Math.log10(Math.max(1, r.implied_value_usd));
  const left = ((lo - barLo) / (barHi - barLo)) * 100;
  const width = Math.max(2, ((hi - lo) / (barHi - barLo)) * 100);
  const tick = ((mid - barLo) / (barHi - barLo)) * 100;
  return `<div class="imp">
    <div class="imp-val">${fmtUsd(r.implied_value_usd)}</div>
    <div class="imp-bar"><span class="imp-range" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span><span class="imp-tick" style="left:${tick.toFixed(1)}%"></span></div>
    <div class="imp-range-text">${fmtUsd(r.p25_usd)} – ${fmtUsd(r.p75_usd)}</div>
  </div>`;
}

function rowHtml(r) {
  const badges = [
    r.is_watchlist ? '<span class="tag tag-watch">watchlist</span>' : '',
    r.is_early ? '<span class="tag tag-early">early</span>' : '',
  ].join(' ');
  return `<tr data-slug="${escapeHtml(r.slug)}">
    <td class="num">${r.rank}</td>
    <td><span class="name">${escapeHtml(r.name)}</span> ${badges}</td>
    <td class="num">${fmtUsd(r.tvl_usd)}</td>
    <td class="num ${r.change_7d !== null && r.change_7d < 0 ? 'neg' : ''}">${fmtChange(r.change_7d)}</td>
    <td class="num">${fmtDays(r.days_no_token)}</td>
    <td class="num">${impliedCell(r)}</td>
    <td class="num">${fmtMoney(r.slice_usd)}</td>
    <td class="num ${r.net_usd < 0 ? 'neg' : ''}">${fmtMoney(r.net_usd)}</td>
    <td class="num ${r.net_per_hour_usd < 0 ? 'neg' : ''}">${fmtMoney(r.net_per_hour_usd)}</td>
    <td><span class="verdict ${verdictClass(r.verdict)}">${r.verdict}</span></td>
  </tr>`;
}

function renderTable() {
  const list = sortedRows(filteredRows());
  $('#tbody').innerHTML = list.map(rowHtml).join('');
  $('#shown-count').textContent = `${list.length} of ${rows.length} shown`;
}

function renderEarly() {
  const early = rows.filter((r) => r.is_early).sort((a, b) => a.rank - b.rank);
  $('#tbody-early').innerHTML = early
    .map(
      (r) => `<tr data-slug="${escapeHtml(r.slug)}">
        <td class="num">${r.rank}</td>
        <td><span class="name">${escapeHtml(r.name)}</span> <span class="tag tag-early">early</span></td>
        <td class="num">${fmtUsd(r.tvl_usd)}</td>
        <td class="num">${fmtDays(r.days_no_token)}</td>
        <td class="num">${fmtUsd(r.implied_value_usd)}</td>
        <td class="num">${fmtMoney(r.slice_usd)}</td>
        <td class="num ${r.net_usd < 0 ? 'neg' : ''}">${fmtMoney(r.net_usd)}</td>
        <td><span class="verdict ${verdictClass(r.verdict)}">${r.verdict}</span></td>
      </tr>`,
    )
    .join('');
}

function renderHero() {
  const farms = rows.filter((r) => r.verdict === 'FARM');
  if (farms.length === 0) return;
  const best = farms.sort((a, b) => b.net_per_hour_usd - a.net_per_hour_usd)[0];
  const hero = $('#hero');
  hero.innerHTML = `Farm next: <b>${escapeHtml(best.name)}</b> &mdash; ${fmtMoney(best.net_per_hour_usd)}/h net &middot; FARM &middot; ${escapeHtml(best.category ?? 'Uncategorized')}, ${fmtUsd(best.tvl_usd)} TVL, no token for ${fmtDays(best.days_no_token)}`;
}

function renderOos() {
  const o = META.oos.loo;
  const pct = (x) => `${Math.round(x * 100)}%`;
  $('#oos-body').innerHTML = [
    ['Median miss', `×${o.medianMiss.toFixed(2)}`, `×${o.flatMedianMiss.toFixed(2)}`],
    ['Within 3×', pct(o.within3), pct(o.flatWithin3)],
    ['Within 10×', pct(o.within10), pct(o.flatWithin10)],
    ['Rank corr', o.rankCorr.toFixed(2), o.flatRankCorr.toFixed(2)],
  ]
    .map(([label, curve, flat]) => `<tr><td>${label}</td><td class="num">${curve}</td><td class="num">${flat}</td></tr>`)
    .join('');
}

function renderFarmNext() {
  $('#farm-next').innerHTML = META.farmNext
    .map(
      (f) => `<li><button type="button" data-slug="${escapeHtml(f.slug)}" class="farm-next-row">
        <span class="name">${escapeHtml(f.name)}</span>
        <span class="num ${f.netUsd < 0 ? 'neg' : ''}">${fmtMoney(f.netPerHourUsd)}/h</span>
        <span class="verdict ${verdictClass(f.verdict)}">${f.verdict}</span>
      </button></li>`,
    )
    .join('');
}

function renderScatter() {
  const svg = $('#scatter');
  const W = 340;
  const H = 240;
  const padL = 46;
  const padR = 8;
  const padT = 10;
  const padB = 26;
  const xs = [...META.compsPoints.map((p) => p[0]), ...META.boardPoints.map((p) => p[0])];
  const ys = [...META.compsPoints.map((p) => p[1]), ...META.boardPoints.map((p) => p[1])];
  const x0 = Math.floor(Math.min(...xs));
  const x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.ceil(Math.max(...ys));
  const X = (x) => padL + ((x - x0) / (x1 - x0)) * (W - padL - padR);
  const Y = (y) => H - padB - ((y - y0) / (y1 - y0)) * (H - padT - padB);
  const dot = (p, cls) => `<circle class="${cls}" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.2"/>`;
  let curve = '';
  for (let i = 0; i <= 24; i++) {
    const x = x0 + ((x1 - x0) * i) / 24;
    const y = META.model.a + META.model.b * x;
    curve += `${i === 0 ? 'M' : 'L'}${X(x).toFixed(1)},${Y(y).toFixed(1)} `;
  }
  const ticks = [];
  for (let x = x0; x <= x1; x++) {
    const anchor = x === x0 ? 'start' : x === x1 ? 'end' : 'middle';
    ticks.push(`<line x1="${X(x)}" y1="${H - padB}" x2="${X(x)}" y2="${H - padB + 4}" class="axis"/><text x="${X(x)}" y="${H - 8}" class="axis-label" text-anchor="${anchor}">10^${x}</text>`);
  }
  for (let y = y0; y <= y1; y++) {
    ticks.push(`<line x1="${padL - 4}" y1="${Y(y)}" x2="${padL}" y2="${Y(y)}" class="axis"/><text x="${padL - 6}" y="${Y(y) + 3}" class="axis-label" text-anchor="end">10^${y}</text>`);
  }
  svg.innerHTML = `
    <rect x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" class="plot-bg"/>
    ${ticks.join('')}
    <text x="10" y="${(H - padB + padT) / 2}" class="axis-label" text-anchor="middle" transform="rotate(-90 10 ${(H - padB + padT) / 2})">value (log10 USD)</text>
    ${META.compsPoints.map((p) => dot(p, 'dot-comp')).join('')}
    ${META.boardPoints.map((p) => dot(p, 'dot-board')).join('')}
    <path d="${curve}" class="fit-line"/>`;
}

function fillMeta() {
  const m = META;
  const set = (key, text) => $$('[data-meta="' + key + '"]').forEach((el) => { el.textContent = text; });
  set('asOf', m.asOf);
  set('protocols', m.counts.protocols.toLocaleString('en-US'));
  set('comps', String(m.counts.comps));
  set('a', m.model.a.toFixed(4));
  set('b', m.model.b.toFixed(4));
  set('r2', m.model.rSquared.toFixed(2));
  set('looMiss', m.oos.loo.medianMiss.toFixed(2));
  set('looWithin3', String(Math.round(m.oos.loo.within3 * 100)));
  set('looWithin10', String(Math.round(m.oos.loo.within10 * 100)));
  set('looRank', m.oos.loo.rankCorr.toFixed(2));
  set('flatMiss', m.oos.loo.flatMedianMiss.toFixed(2));
  set('flatRank', m.oos.loo.flatRankCorr.toFixed(2));
  set('trainN', String(m.oos.timeSplit.trainN));
  set('testN', String(m.oos.timeSplit.testN));
  set('tsMiss', m.oos.timeSplit.medianMiss.toFixed(2));
  set('tsFlat', m.oos.timeSplit.flatMedianMiss.toFixed(2));
  set('tsRank', m.oos.timeSplit.rankCorr.toFixed(2));
  set('tsFlatRank', m.oos.timeSplit.flatRankCorr.toFixed(2));
  set('seed', String(m.model.bootstrap.seed));
  set('aMean', m.model.bootstrap.aMean.toFixed(3));
  set('aSd', m.model.bootstrap.aSd.toFixed(3));
  set('bMean', m.model.bootstrap.bMean.toFixed(3));
  set('bSd', m.model.bootstrap.bSd.toFixed(3));
  set('bandLo', m.model.bandLo.toFixed(2));
  set('bandHi', m.model.bandHi.toFixed(2));
  set('modelName', 'comps-fit-1');
  const s = (key, text) => $$('[data-stat="' + key + '"]').forEach((el) => { el.textContent = text; });
  s('watchlist', `${m.counts.watchlistCovered}/${m.counts.watchlistTotal}`);
  s('boardRows', String(m.counts.boardRows));
  s('comps', String(m.counts.comps));
  s('setAside', String(m.counts.setAside));
  s('verdicts', `${m.verdicts.FARM}/${m.verdicts.THIN}/${m.verdicts.SKIP}`);
  s('loo', `×${m.oos.loo.medianMiss.toFixed(2)}`);
  $$('[data-tab-count="board"]').forEach((el) => { el.textContent = String(m.counts.boardRows); });
  $$('[data-tab-count="early"]').forEach((el) => { el.textContent = String(m.counts.earlyFinds); });
}

// ---------------------------------------------------------------- detail view

function openDetail(slug) {
  const r = rows.find((x) => x.slug === slug);
  const panel = $('#detail');
  if (!r) {
    panel.classList.add('hidden');
    return;
  }
  const c = recompute(r);
  const steps = r.farm_steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  panel.innerHTML = `
    <h2>${escapeHtml(r.name)} <span class="tag ${r.is_watchlist ? 'tag-watch' : ''}">${r.is_watchlist ? 'watchlist' : ''}</span>${r.is_early ? ' <span class="tag tag-early">early</span>' : ''}</h2>
    <p class="detail-sub">Rank ${r.rank} of ${rows.length} · ${escapeHtml(r.category ?? 'Uncategorized')} · ${escapeHtml(r.chains.join(', '))} · no token for ${fmtDays(r.days_no_token)}</p>
    <dl class="factors">
      <div><dt>Base (size curve)</dt><dd>${fmtUsd(r.base_usd)}</dd></div>
      <div><dt>Peers (${escapeHtml(r.category ?? 'Uncategorized')})</dt><dd>${fmtFactor(c.peers)}</dd></div>
      <div><dt>Momentum (7D ${fmtChange(r.change_7d)})</dt><dd>${fmtFactor(r.momentum)}</dd></div>
      <div><dt>Record (${fmtDays(r.days_no_token)} no token)</dt><dd>${fmtFactor(r.record)}</dd></div>
      <div class="total"><dt>Implied value</dt><dd>${fmtUsd(r.implied_value_usd)}</dd></div>
      <div><dt>P25 – P75 band</dt><dd>${fmtUsd(r.p25_usd)} – ${fmtUsd(r.p75_usd)}</dd></div>
    </dl>
    <dl class="factors">
      <div><dt>Slice of the launch ($1,000 in)</dt><dd>${fmtMoney(r.slice_usd)}</dd></div>
      <div><dt>Gas (4 tx on ${escapeHtml(r.gas_chain)}, $${r.gas_per_tx_usd.toFixed(2)} each)</dt><dd>-${fmtMoney(r.gas_usd).slice(1)}</dd></div>
      <div><dt>T-bill yield given up (60 days)</dt><dd>-$${META.farm.oppCostUsd.toFixed(2)}</dd></div>
      <div class="total"><dt>Net</dt><dd>${fmtMoney(r.net_usd)}</dd></div>
      <div><dt>Bridge in (from Ethereum, not in net)</dt><dd>-$${r.bridge_usd.toFixed(2)}</dd></div>
      <div><dt>Net after the bridge</dt><dd>${fmtMoney(r.net_after_bridge_usd)}</dd></div>
      <div><dt>Net if the launch is half the implied value</dt><dd>${fmtMoney(r.slice_usd / 2 - r.gas_usd - META.farm.oppCostUsd)}</dd></div>
      <div><dt>Net if the launch is twice the implied value</dt><dd>${fmtMoney(r.slice_usd * 2 - r.gas_usd - META.farm.oppCostUsd)}</dd></div>
      <div><dt>Net per active hour (2 h)</dt><dd>${fmtMoney(r.net_per_hour_usd)}/h</dd></div>
      <div><dt>Break-even launch odds</dt><dd>${Math.round(r.break_even_odds * 100)}%</dd></div>
      <div class="total"><dt>Verdict</dt><dd><span class="verdict ${verdictClass(r.verdict)}">${r.verdict}</span></dd></div>
    </dl>
    <h3>The farm, in five steps</h3>
    <ol class="steps">${steps}</ol>
    <button type="button" id="detail-close">Close</button>`;
  panel.classList.remove('hidden');
  $('#detail-close').addEventListener('click', () => {
    panel.classList.add('hidden');
    if (location.hash.startsWith('#detail=')) history.replaceState(null, '', location.pathname + location.search);
  });
  panel.scrollIntoView({ behavior: 'auto', block: 'nearest' });
}

// ---------------------------------------------------------------- tabs, filters, sorting

function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#panel-board').classList.toggle('hidden', name !== 'board');
  $('#panel-early').classList.toggle('hidden', name !== 'early');
  $('#panel-method').classList.toggle('hidden', name !== 'method');
}

function applyHash() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const detail = hash.get('detail');
  const verdict = hash.get('verdict');
  const tab = hash.get('tab');
  if (tab && ['board', 'early', 'method'].includes(tab)) showTab(tab);
  if (verdict && ['FARM', 'THIN', 'SKIP'].includes(verdict)) {
    $('#f-verdict').value = verdict;
    showTab('board');
    renderTable();
  }
  if (detail) openDetail(detail);
}

function initControls() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  $('#f-category').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  $('#f-chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  ['f-search', 'f-category', 'f-chain', 'f-tier', 'f-verdict'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderTable);
    document.getElementById(id).addEventListener('change', renderTable);
  });
  $('#f-reset').addEventListener('click', () => {
    $('#f-search').value = '';
    $('#f-category').value = '';
    $('#f-chain').value = '';
    $('#f-tier').value = '';
    $('#f-verdict').value = '';
    renderTable();
  });
  $$('#board-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = -sortDir;
      else {
        sortKey = key;
        sortDir = key === 'name' ? 1 : -1;
      }
      $$('#board-table th[data-sort]').forEach((x) => x.classList.remove('sorted'));
      th.classList.add('sorted');
      renderTable();
    });
  });
  document.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) {
      history.replaceState(null, '', `#detail=${tr.dataset.slug}`);
      openDetail(tr.dataset.slug);
      return;
    }
    const fn = e.target.closest('[data-slug].farm-next-row');
    if (fn) {
      history.replaceState(null, '', `#detail=${fn.dataset.slug}`);
      openDetail(fn.dataset.slug);
    }
  });
  window.addEventListener('hashchange', applyHash);
}

// ---------------------------------------------------------------- self-check

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function selfCheck() {
  const badge = $('#badge');
  try {
    const res = await fetch('../board.json');
    if (!res.ok) throw new Error(`board.json answered ${res.status}`);
    const text = await res.text();
    const doc = JSON.parse(text);
    const boardRows = doc.rows ?? doc;
    const digest = await sha256Hex(text);
    const digestOk = digest === META.digest;
    let matched = 0;
    let firstBad = '';
    for (const r of boardRows) {
      const c = recompute(r);
      const valueOk = Math.round(c.implied) === r.implied_value_usd;
      const verdictOk = c.verdict === r.verdict;
      const netOk = Math.abs(c.net - r.net_usd) < 0.01;
      if (valueOk && verdictOk && netOk) matched++;
      else if (!firstBad) firstBad = `${r.slug}: implied ${Math.round(c.implied)} vs ${r.implied_value_usd}, verdict ${c.verdict} vs ${r.verdict}`;
    }
    const allOk = digestOk && matched === boardRows.length;
    badge.classList.remove('pending');
    badge.classList.add(allOk ? 'ok' : 'fail');
    badge.textContent = allOk
      ? `✓ page = board.json — ${matched}/${boardRows.length} values and verdicts match · digest ${digest.slice(0, 12)}… matches`
      : `✗ self-check failed — ${matched}/${boardRows.length} rows match, digest ${digestOk ? 'matches' : 'does NOT match'}${firstBad ? ` · first mismatch: ${firstBad}` : ''}`;
  } catch (err) {
    badge.classList.remove('pending');
    badge.classList.add('fail');
    badge.textContent = `✗ self-check failed — ${err.message}`;
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  fillMeta();
  renderOos();
  renderFarmNext();
  renderScatter();
  try {
    const res = await fetch('../board.json');
    if (!res.ok) throw new Error(`board.json answered ${res.status}`);
    const doc = await res.json();
    rows = doc.rows ?? doc;
    const p25s = rows.map((r) => Math.log10(Math.max(1, r.p25_usd)));
    const p75s = rows.map((r) => Math.log10(Math.max(1, r.p75_usd)));
    barLo = Math.min(...p25s);
    barHi = Math.max(...p75s);
    initControls();
    renderTable();
    renderEarly();
    renderHero();
    applyHash();
  } catch (err) {
    $('#tbody').innerHTML = `<tr><td colspan="10">Could not load board.json: ${escapeHtml(err.message)}</td></tr>`;
  }
  selfCheck();
}

boot();
