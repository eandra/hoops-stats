'use strict';

const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const app = document.getElementById('app');

// Box score columns in display order. `key` matches ESPN's boxscore stat keys,
// `hk` is the matching key in our season-highs data (scripts/build-data.mjs).
const COLS = [
  { label: 'PTS', key: 'points', cls: 'pts', hk: 'pts' },
  { label: 'REB', key: 'rebounds', cls: 's', hk: 'reb' },
  { label: 'AST', key: 'assists', cls: 's', hk: 'ast' },
  { label: 'BLK', key: 'blocks', cls: 's', hk: 'blk' },
  { label: 'STL', key: 'steals', cls: 's', hk: 'stl' },
  { label: '+/-', key: 'plusMinus', cls: 'pm', hk: 'pm' },
  { label: 'FG', key: 'fieldGoalsMade-fieldGoalsAttempted', cls: 'sh', hk: 'fgm' },
  { label: '3P', key: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', cls: 'sh', hk: 'tpm' },
  { label: 'FT', key: 'freeThrowsMade-freeThrowsAttempted', cls: 'sh', hk: 'ftm' },
  { label: 'TO', key: 'turnovers', cls: 's' },
  { label: 'MIN', key: 'minutes', cls: 'min' },
];

// ---------- helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ymd = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
const parseYmd = s => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
// ESPN's schedule days are US Eastern, whatever the viewer's time zone.
const etYmd = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Our own generated data (data/…). Missing files resolve to null.
const localCache = new Map();
function local(path) {
  if (!localCache.has(path)) {
    localCache.set(path, fetch(path).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return localCache.get(path);
}

// Player names link to the player page from everywhere.
const playerLink = (id, name, title) =>
  `<a class="pl" href="#/player/${esc(id)}"${title ? ` title="${esc(title)}"` : ''}>${esc(name)}</a>`;

// Table rows that open somewhere on tap, except when the tap hits a link inside them.
function bindRows(attr, href) {
  app.querySelectorAll(`[data-${attr}]`).forEach(r => r.onclick = e => {
    if (!e.target.closest('a')) location.hash = href(r.dataset[attr]);
  });
}

function setView(html) { app.innerHTML = html; }
function loading() { setView('<p class="msg">Loading…</p>'); window.scrollTo(0, 0); }
function fail(err) { setView(`<p class="msg">Couldn't load data.<br><small>${esc(err.message)}</small></p>`); }

function seasonTag(type) {
  return { 1: 'Preseason', 3: 'Playoffs', 5: 'Play-In' }[type] || '';
}

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

// ---------- games list ----------

async function showGames(date) {
  const d = parseYmd(date);
  const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
  const bar = `
    <div class="datebar">
      <button data-go="${addDays(date, -1)}" aria-label="Previous day">‹</button>
      <div class="label">${esc(label)}<input type="date" value="${iso}" aria-label="Pick date"></div>
      <button data-go="${addDays(date, 1)}" aria-label="Next day">›</button>
    </div>`;
  setView(bar + '<p class="msg">Loading…</p>');
  bindDateBar();

  try {
    const data = await getJSON(`${API}/scoreboard?dates=${date}`);
    const events = data.events || [];
    rememberDay(date, events);
    lastDay = date;
    const list = events.length
      ? `<div class="games">${events.map(gameCard).join('')}</div>`
      : '<p class="msg">No games on this day.</p>';
    setView(bar + list);
    bindDateBar();
  } catch (e) { fail(e); }
}

function bindDateBar() {
  app.querySelectorAll('[data-go]').forEach(b =>
    b.onclick = () => { location.hash = '#/d/' + b.dataset.go; });
  const input = app.querySelector('input[type=date]');
  if (input) input.onchange = () => {
    if (input.value) location.hash = '#/d/' + input.value.replace(/-/g, '');
  };
}

function gameCard(ev) {
  const c = ev.competitions[0];
  const st = ev.status.type;
  const started = st.state !== 'pre';
  // ESPN lists home first; show away on top.
  const teams = [...c.competitors].sort((a, b) => (a.homeAway === 'away' ? -1 : 1));
  const rows = teams.map(t => `
    <div class="row ${started && st.completed && !t.winner ? 'loser' : ''}">
      <img src="${esc(t.team.logo)}" alt="" loading="lazy">
      <span class="name">${esc(t.team.shortDisplayName || t.team.displayName)}</span>
      <span class="score">${started ? esc(t.score) : ''}</span>
    </div>`).join('');

  let status;
  if (st.state === 'pre') {
    status = new Date(ev.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } else {
    status = st.shortDetail;
  }
  const tag = seasonTag(ev.season?.type);
  const body = `
    <div class="teams">${rows}</div>
    <div class="status ${st.state === 'in' ? 'live' : ''}">
      ${esc(status)}${tag ? `<div class="tag">${tag}</div>` : ''}
    </div>`;
  // Only games that have started have a box score worth opening.
  return started
    ? `<a class="game" href="#/g/${ev.id}">${body}</a>`
    : `<div class="game">${body}</div>`;
}

// ---------- box score ----------

let boxState = null; // { id, data, side, flags, nav, results }

// Games of a day that have a box score (started), in schedule order, so
// box scores can be swiped through like the Games list. Keyed by the date
// the list was shown for.
const dayGames = new Map();
let lastDay = null;
const rememberDay = (date, events) => dayGames.set(date, Promise.resolve(
  events.filter(ev => ev.status.type.state !== 'pre').map(ev => ev.id)));
function loadDay(date) {
  if (!dayGames.has(date)) {
    dayGames.set(date, getJSON(`${API}/scoreboard?dates=${date}`)
      .then(d => (rememberDay(date, d.events || []), dayGames.get(date)))
      .catch(e => { dayGames.delete(date); throw e; }));
  }
  return dayGames.get(date);
}

// The day list this game sits in: the one the user came from, else its own date.
async function findNav(id, data) {
  const own = etYmd(data.header.competitions[0].date);
  for (const date of new Set([lastDay, own].filter(Boolean))) {
    const ids = await loadDay(date).catch(() => []);
    const i = ids.indexOf(id);
    if (i >= 0) return { date, ids, i };
  }
  return null;
}

async function showGame(id) {
  loading();
  try {
    const data = await getJSON(`${API}/summary?event=${id}`);
    boxState = { id, data, side: 0, flags: null, nav: null, results: null };
    renderGame();
    const season = data.header?.season;
    const [flags, nav, results] = await Promise.all([loadFlags(id, data), findNav(id, data),
      season ? local(`data/${season.year}-${season.type}/results.json`) : null]);
    if (boxState?.id !== id) return;
    Object.assign(boxState, { flags, nav, results });
    if (flags || nav || results) renderGame();
  } catch (e) { fail(e); }
}

// Step to the previous/next game of the day. Replaces the history entry so
// Back returns to where the user was before the box scores.
function stepGame(dir) {
  const nav = boxState?.nav;
  const id = nav?.ids[nav.i + dir];
  if (!id) return false;
  lastDay = nav.date;
  location.replace('#/g/' + id);
  return true;
}

// Swipe left/right on a box score for the next/previous game. The page
// follows the finger, then slides out and the next game slides in.
(() => {
  let s = null;
  const reset = () => { app.style.transition = 'transform .18s ease, opacity .18s ease'; app.style.transform = ''; app.style.opacity = ''; };
  app.addEventListener('touchstart', e => {
    s = null;
    // The game flow chart uses horizontal drags for its readout.
    if (!location.hash.startsWith('#/g/') || e.touches.length !== 1 || e.target.closest('.flow, .hscroll')) return;
    s = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null, dx: 0 };
  }, { passive: true });
  app.addEventListener('touchmove', e => {
    if (!s) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.axis && Math.abs(dx) + Math.abs(dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    if (s.axis !== 'x') return;
    const nav = boxState?.nav;
    const can = nav && nav.ids[nav.i + (dx < 0 ? 1 : -1)];
    s.dx = can ? dx : dx / 4; // resist where there's no game to go to
    app.style.transition = 'none';
    app.style.transform = `translateX(${s.dx}px)`;
    app.style.opacity = String(1 - Math.min(Math.abs(s.dx) / 600, 0.4));
  }, { passive: true });
  app.addEventListener('touchend', () => {
    if (!s || s.axis !== 'x') { s = null; return; }
    const { dx } = s;
    const dir = dx < 0 ? 1 : -1;
    s = null;
    const nav = boxState?.nav;
    if (Math.abs(dx) < 70 || !nav?.ids[nav.i + dir]) return reset();
    app.style.transition = 'transform .15s ease-in, opacity .15s ease-in';
    app.style.transform = `translateX(${-dir * 100}%)`;
    app.style.opacity = '0';
    setTimeout(() => {
      stepGame(dir);
      app.style.transition = 'none';
      app.style.transform = `translateX(${dir * 40}px)`;
      requestAnimationFrame(() => requestAnimationFrame(reset));
    }, 150);
  });
  app.addEventListener('touchcancel', () => { if (s?.axis === 'x') reset(); s = null; });
  document.addEventListener('keydown', e => {
    if (!location.hash.startsWith('#/g/') || e.altKey || e.metaKey || e.ctrlKey || e.target.closest('input')) return;
    if (e.key === 'ArrowRight') stepGame(1);
    else if (e.key === 'ArrowLeft') stepGame(-1);
  });
})();

// Season-high flags for a game: { p: {athleteId: [hk…]}, l: {athleteId: [hk…]} }.
// Games already processed by the data builder have a precomputed file; newer
// ones (e.g. tonight's) are compared against the current highs instead.
async function loadFlags(id, data) {
  const season = data.header?.season;
  if (!season) return null;
  const dir = `data/${season.year}-${season.type}`;
  const pre = await local(`${dir}/flags/${id}.json`);
  if (pre) return pre;

  const highs = await local(`${dir}/highs.json`);
  if (!highs) return null;
  const flags = { p: {}, l: {} };
  for (const block of data.boxscore?.players || []) {
    const st = block.statistics?.[0];
    if (!st) continue;
    for (const a of st.athletes || []) {
      if (a.didNotPlay || !a.stats?.length) continue;
      const prev = highs.players[a.athlete.id];
      for (const c of COLS) {
        if (!c.hk) continue;
        const v = parseInt(a.stats[st.keys.indexOf(c.key)], 10);
        if (!(v > 0)) continue;
        if (prev && v >= prev[highs.keys.indexOf(c.hk)]) (flags.p[a.athlete.id] ||= []).push(c.hk);
        const lg = highs.league[c.hk];
        if (lg && v >= lg.v) (flags.l[a.athlete.id] ||= []).push(c.hk);
      }
    }
  }
  return flags;
}

// ---------- game flow ----------

// Score margin over the game, from ESPN's play-by-play: away team's lead
// above the zero line, home team's below. 12-minute quarters, 5-minute OTs.
const periodStart = p => (p <= 4 ? (p - 1) * 720 : 2880 + (p - 5) * 300);
const periodLen = p => (p <= 4 ? 720 : 300);
const periodName = p => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);
const clockSecs = c => {
  const [m, sec] = String(c ?? '0').includes(':') ? String(c).split(':') : [0, c];
  return +m * 60 + parseFloat(sec || 0);
};
const fmtClock = secs => (secs >= 60
  ? `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`
  : secs.toFixed(secs % 1 ? 1 : 0));
const periodAt = t => (t < 2880 ? Math.min(4, Math.floor(t / 720) + 1) : 5 + Math.floor((t - 2880) / 300));

// Score changes as { t: seconds elapsed, a: away, h: home }, plus how far
// the game has got (last play) and how many periods it has.
function flowData(plays) {
  const pts = [{ t: 0, a: 0, h: 0 }];
  let end = 0, periods = 4;
  for (const pl of plays || []) {
    const p = pl.period?.number;
    if (!p || pl.awayScore == null || pl.homeScore == null) continue;
    const t = Math.max(end, periodStart(p) + periodLen(p) - clockSecs(pl.clock?.displayValue));
    end = t;
    periods = Math.max(periods, p);
    const last = pts[pts.length - 1];
    if (pl.awayScore !== last.a || pl.homeScore !== last.h) pts.push({ t, a: pl.awayScore, h: pl.homeScore });
  }
  return { pts, end, total: periodStart(periods) + periodLen(periods), periods };
}

const FLOW_H = 150;
const FLOW_PAD = { l: 26, r: 8, t: 8, b: 20 };

function flowChart(data, away, home, width) {
  const f = flowData(data.plays);
  if (f.pts.length < 2 || width < 200) return '';
  const { pts, end, total, periods } = f;
  const margin = p => p.a - p.h;
  const maxLead = Math.max(...pts.map(margin)), minLead = Math.min(...pts.map(margin));
  // Symmetric, with headroom for the biggest-lead labels, and at most two
  // clean ticks per side.
  const ymax = Math.max(maxLead, -minLead, 4) * 1.35;
  const step = [5, 10, 20, 25].find(st => ymax / st < 3) || 50;
  const { l, r, t: top, b } = FLOW_PAD;
  const pw = width - l - r, ph = FLOW_H - top - b;
  const x = s => l + s / total * pw;
  const y = m => top + (ymax - m) / (2 * ymax) * ph;
  const y0 = y(0);

  let d = `M${x(0)},${y0}`;
  for (const p of pts.slice(1)) d += `H${x(p.t).toFixed(1)}V${y(margin(p)).toFixed(1)}`;
  d += `H${x(end).toFixed(1)}`;
  const area = `${d}V${y0}Z`;

  const grid = [];
  for (let v = step; v <= ymax; v += step) {
    for (const m of [v, -v]) {
      grid.push(`<line class="g" x1="${l}" x2="${width - r}" y1="${y(m)}" y2="${y(m)}"/>`);
      grid.push(`<text class="tk" x="${l - 5}" y="${y(m) + 3.5}" text-anchor="end">${v}</text>`);
    }
  }
  const quarters = [];
  for (let p = 1; p <= periods; p++) {
    if (p > 1) quarters.push(`<line class="q" x1="${x(periodStart(p))}" x2="${x(periodStart(p))}" y1="${top}" y2="${FLOW_H - b}"/>`);
    quarters.push(`<text class="tk" x="${x(periodStart(p) + periodLen(p) / 2)}" y="${FLOW_H - 5}" text-anchor="middle">${periodName(p)}</text>`);
  }

  // Each team's biggest lead: a dot where it first happened, labeled.
  const leadMark = (sign, cls, abbr) => {
    const best = sign > 0 ? maxLead : -minLead;
    if (best <= 0) return '';
    const p = pts.find(q => margin(q) * sign === best);
    const cx = x(p.t), cy = y(margin(p));
    // Label on the outer side of the dot, kept inside the plot.
    const lx = Math.max(l + 22, Math.min(width - r - 22, cx));
    return `<circle class="dot ${cls}" cx="${cx}" cy="${cy}" r="4"/>
      <text class="lab" x="${lx}" y="${sign > 0 ? cy - 8 : cy + 15}" text-anchor="middle">${esc(abbr)} +${best}</text>`;
  };

  return `
    <div class="flow" data-total="${total}" data-end="${end}">
      <svg width="${width}" height="${FLOW_H}" role="img" aria-label="Score margin over the game">
        <defs>
          <clipPath id="fa"><rect x="0" y="0" width="${width}" height="${y0}"/></clipPath>
          <clipPath id="fh"><rect x="0" y="${y0}" width="${width}" height="${FLOW_H}"/></clipPath>
        </defs>
        ${grid.join('')}${quarters.join('')}
        <line class="zero" x1="${l}" x2="${width - r}" y1="${y0}" y2="${y0}"/>
        <path class="area away" clip-path="url(#fa)" d="${area}"/>
        <path class="area home" clip-path="url(#fh)" d="${area}"/>
        <path class="ln away" clip-path="url(#fa)" d="${d}"/>
        <path class="ln home" clip-path="url(#fh)" d="${d}"/>
        <g class="key"><rect class="away" x="${l + 6}" y="${top + 4}" width="10" height="3" rx="1.5"/>
          <text x="${l + 20}" y="${top + 9}">${esc(away.team.abbreviation)} leads</text>
          <rect class="home" x="${l + 6}" y="${FLOW_H - b - 9}" width="10" height="3" rx="1.5"/>
          <text x="${l + 20}" y="${FLOW_H - b - 4}">${esc(home.team.abbreviation)} leads</text></g>
        ${leadMark(1, 'away', away.team.abbreviation)}${leadMark(-1, 'home', home.team.abbreviation)}
        <line class="xh" x1="0" x2="0" y1="${top}" y2="${FLOW_H - b}" visibility="hidden"/>
      </svg>
      <div class="tip" hidden><b></b><span></span></div>
    </div>`;
}

// Crosshair + readout: snaps to the score at the pointer's game time.
function bindFlow(away, home) {
  const box = app.querySelector('.flow');
  if (!box) return;
  const svg = box.querySelector('svg'), xh = box.querySelector('.xh'), tip = box.querySelector('.tip');
  const { pts } = flowData(boxState.data.plays);
  const total = +box.dataset.total, end = +box.dataset.end;
  const pw = svg.width.baseVal.value - FLOW_PAD.l - FLOW_PAD.r;
  const hide = () => { xh.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', e => {
    const px = e.clientX - svg.getBoundingClientRect().left;
    const t = Math.max(0, Math.min(end, (px - FLOW_PAD.l) / pw * total));
    let p = pts[0];
    for (const q of pts) { if (q.t <= t) p = q; else break; }
    const per = periodAt(Math.min(t, total - 0.01));
    const left = periodStart(per) + periodLen(per) - t;
    const m = p.a - p.h;
    const cx = FLOW_PAD.l + t / total * pw;
    xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
    tip.querySelector('b').textContent = m === 0 ? 'Tied' : `${m > 0 ? away.team.abbreviation : home.team.abbreviation} +${Math.abs(m)}`;
    tip.querySelector('span').textContent = `${away.team.abbreviation} ${p.a}–${p.h} ${home.team.abbreviation} · ${periodName(per)} ${fmtClock(left)}`;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(box.clientWidth - w, cx - w / 2))}px`;
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
}

// Points per period, and the margin at the end of each.
function lineScore(away, home, leadChanges) {
  const per = t => (t.linescores || []).map(s => num(s.displayValue));
  const a = per(away), h = per(home);
  if (!a.length || a.length !== h.length) return '';
  let ca = 0, ch = 0;
  const ends = a.map((v, i) => {
    ca += v; ch += h[i];
    return ca === ch ? 'Tied' : `${ca > ch ? away.team.abbreviation : home.team.abbreviation} +${Math.abs(ca - ch)}`;
  });
  const head = a.map((v, i) => `<th>${periodName(i + 1)}</th>`).join('');
  const row = (t, v) => `<tr><td class="l">${esc(t.team.abbreviation)}</td>${v.map(x => `<td>${x}</td>`).join('')}<td class="v">${esc(t.score ?? '')}</td></tr>`;
  return `
    <table class="tbl linescore">
      <thead><tr><th></th>${head}<th>T</th></tr></thead>
      <tbody>${row(away, a)}${row(home, h)}
        <tr class="end"><td class="l">After</td>${ends.map(e => `<td>${esc(e)}</td>`).join('')}<td></td></tr></tbody>
    </table>
    ${leadChanges != null ? `<p class="note flownote">Lead changes: ${esc(leadChanges)}</p>` : ''}`;
}

const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

// A team's W-L and streak right after this game (before it, while it's
// still being played). From our results data; games it doesn't have yet
// (e.g. tonight's) are placed by date. Falls back to ESPN's record, no streak.
function teamRecord(t, comp, results) {
  const log = results?.teams[t.team.id];
  if (!log) return t.record?.find(r => r.type === 'total')?.summary || '';
  const date = etYmd(comp.date);
  const i = log.findIndex(r => r[0] === boxState.id);
  const res = i >= 0 ? log.slice(0, i + 1).map(r => r[2]) : log.filter(r => r[1] < date).map(r => r[2]);
  if (i < 0 && comp.status.type.completed) {
    const other = comp.competitors.find(c => c !== t);
    if (t.winner || other?.winner) res.push(t.winner ? 'W' : 'L');
  }
  if (!res.length) return '0-0';
  const w = res.filter(r => r === 'W').length;
  let n = 0;
  while (n < res.length && res[res.length - 1 - n] === res[res.length - 1]) n++;
  return `${w}-${res.length - w} · ${res[res.length - 1]}${n}`;
}

function renderGame() {
  const { data, side, flags } = boxState;
  const comp = data.header.competitions[0];
  const status = comp.status.type;
  const away = comp.competitors.find(t => t.homeAway === 'away');
  const home = comp.competitors.find(t => t.homeAway === 'home');
  const date = etYmd(comp.date);

  const teamHead = t => `
    <a href="#/team/${t.team.id}" class="${status.completed && !t.winner ? 'loser' : ''}">
      <img src="${esc(t.team.logos?.[0]?.href || '')}" alt="">
      <div class="abbr">${esc(t.team.abbreviation)}</div>
      <div class="pts">${esc(t.score ?? '')}</div>
      <div class="rec">${esc(teamRecord(t, comp, boxState.results))}</div>
    </a>`;

  // Box score team blocks, ordered away then home to match the header.
  const players = [...(data.boxscore.players || [])].sort((a, b) =>
    (a.team.id === away.team.id ? -1 : 1));

  const tabs = players.map((p, i) =>
    `<button data-side="${i}" class="${i === side ? 'on' : ''}">${esc(p.team.abbreviation)}</button>`).join('');

  const tag = seasonTag(data.header.season?.type);
  const nav = boxState.nav;
  const pager = nav && nav.ids.length > 1 ? `
    <span class="pager">
      <button data-step="-1" aria-label="Previous game" ${nav.i ? '' : 'disabled'}>‹</button>
      ${nav.i + 1} of ${nav.ids.length}
      <button data-step="1" aria-label="Next game" ${nav.i < nav.ids.length - 1 ? '' : 'disabled'}>›</button>
    </span>` : '';
  setView(`
    <div class="boxnav"><a class="back" href="#/d/${nav?.date || date}">‹ Games</a>${pager}</div>
    <div class="scorehead">
      ${teamHead(away)}
      <div class="mid">${esc(status.shortDetail)}${tag ? `<div class="tag">${tag}</div>` : ''}</div>
      ${teamHead(home)}
    </div>
    ${flowChart(data, away, home, Math.min(app.clientWidth || window.innerWidth, 760) - 12)}
    ${lineScore(away, home, data.boxscore.teams?.[0]?.statistics?.find(s => s.name === 'leadChanges')?.displayValue)}
    ${players.length ? `<div class="teamtabs">${tabs}</div>${boxTable(players[side], flags)}
      <p class="legend"><span class="dot hi"></span>Player's season high · <span class="dot lhi"></span>League season high</p>`
                     : '<p class="msg">Box score not available yet.</p>'}
  `);
  app.querySelectorAll('[data-side]').forEach(b =>
    b.onclick = () => { boxState.side = +b.dataset.side; renderGame(); });
  app.querySelectorAll('[data-step]').forEach(b => b.onclick = () => stepGame(+b.dataset.step));
  bindFlow(away, home);
}

function boxTable(teamBlock, flags) {
  const st = teamBlock.statistics?.[0];
  if (!st) return '<p class="msg">No stats.</p>';
  const idx = Object.fromEntries(st.keys.map((k, i) => [k, i]));

  const cells = (stats, id) => COLS.map(c => {
    let v = stats[idx[c.key]] ?? '';
    const cls = [];
    if (c.key === 'plusMinus' && v && v !== '0') cls.push(v.startsWith('-') ? 'neg' : 'pos');
    if (id == null && c.key === 'minutes') v = '';
    if (id != null && c.hk && flags) {
      if (flags.l[id]?.includes(c.hk)) cls.push('lhi');
      else if (flags.p[id]?.includes(c.hk)) cls.push('hi');
    }
    const mark = cls.includes('lhi') || cls.includes('hi');
    return `<td class="${cls.join(' ')}">${mark ? `<span class="mk">${esc(v)}</span>` : esc(v)}</td>`;
  }).join('');

  const row = a => {
    const name = a.athlete.shortName || a.athlete.displayName;
    const title = a.athlete.displayName;
    if (!a.stats?.length || a.didNotPlay) {
      return `<tr class="dnp"><td>${playerLink(a.athlete.id, name, title)}</td>
        <td class="why" colspan="${COLS.length}">DNP${a.reason ? ' – ' + esc(a.reason.toLowerCase()) : ''}</td></tr>`;
    }
    return `<tr><td>${playerLink(a.athlete.id, name, title)}</td>${cells(a.stats, a.athlete.id)}</tr>`;
  };

  const starters = st.athletes.filter(a => a.starter);
  const bench = st.athletes.filter(a => !a.starter);
  const sep = text => `<tr class="sep"><td colspan="${COLS.length + 1}">${text}</td></tr>`;

  return `
    <table class="box">
      <colgroup><col class="n">${COLS.map(c => `<col class="${c.cls}">`).join('')}</colgroup>
      <thead><tr><th></th>${COLS.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>
        ${starters.length ? sep('Starters') + starters.map(row).join('') : ''}
        ${bench.length ? sep('Bench') + bench.map(row).join('') : ''}
        ${st.totals?.length ? `<tr class="tot"><td>Team</td>${cells(st.totals)}</tr>` : ''}
      </tbody>
    </table>`;
}

// ---------- standings ----------

// Regular-season standings once it has started, preseason before that.
let standingsP = null;
function loadStandings() {
  if (!standingsP) {
    standingsP = getJSON('https://site.api.espn.com/apis/v2/sports/basketball/nba/standings')
      .then(d => {
        const type = d.children?.[0]?.standings?.seasonType;
        return type === 1 || type === 2 ? d
          : getJSON(`https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?seasontype=2`);
      })
      .catch(e => { standingsP = null; throw e; });
  }
  return standingsP;
}

// Match on name or type: ESPN names some stats oddly (L10 is name "Last Ten Games", type "lasttengames").
const statVal = (entry, name) => entry.stats.find(s => s.name === name || s.type === name)?.displayValue ?? '';
const statNum = (entry, name) => entry.stats.find(s => s.name === name)?.value ?? 0;

async function showStandings() {
  loading();
  try {
    const d = await loadStandings();
    const s0 = d.children[0].standings;
    const html = d.children.map(conf => {
      const entries = [...conf.standings.entries].sort((a, b) => statNum(a, 'playoffSeed') - statNum(b, 'playoffSeed'));
      const rows = entries.map((e, i) => `
        <tr class="link ${i === 5 || i === 9 ? 'cut' : ''}" data-team="${e.team.id}">
          <td class="rk">${i + 1}</td>
          <td class="tm"><img src="${esc(e.team.logos?.[0]?.href)}" alt="" loading="lazy">${esc(e.team.shortDisplayName)}</td>
          <td>${esc(statVal(e, 'wins'))}-${esc(statVal(e, 'losses'))}</td>
          <td>${esc(statVal(e, 'gamesBehind'))}</td>
          <td>${esc(statVal(e, 'streak'))}</td>
          <td>${esc(statVal(e, 'lasttengames'))}</td>
        </tr>`).join('');
      return `
        <h2>${esc(conf.name)}</h2>
        <table class="tbl stand">
          <colgroup><col class="rk"><col><col class="wl"><col class="gb"><col class="st"><col class="l10"></colgroup>
          <thead><tr><th class="rk">#</th><th class="l">Team</th><th>W-L</th><th>GB</th><th>STRK</th><th>L10</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }).join('');
    setView(html + `<p class="note">${esc(s0.seasonDisplayName || '')} ${seasonTag(s0.seasonType) || 'Regular Season'}. Lines mark playoff (6) and play-in (10) spots.</p>`);
    app.querySelectorAll('[data-team]').forEach(r =>
      r.onclick = () => { location.hash = '#/team/' + r.dataset.team; });
  } catch (e) { fail(e); }
}

// ---------- season data (leaders, team stats) ----------

// Which generated season set to show: remembered choice, else the regular
// season once it has games, else whatever exists.
async function pickSet() {
  const index = await local('data/index.json');
  const sets = Object.entries(index?.sets || {}).map(([key, s]) => ({ key, ...s }));
  if (!sets.length) return { sets, set: null };
  let saved = null;
  try { saved = localStorage.getItem('set'); } catch {}
  const set = sets.find(s => s.key === saved)
    || sets.find(s => s.type === 2)
    || sets[sets.length - 1];
  return { sets, set, index };
}

function setChips(sets, set) {
  if (sets.length < 2) return '';
  return `<div class="chips">${sets.map(s =>
    `<button data-set="${s.key}" class="${s.key === set.key ? 'on' : ''}">${esc(s.label)}</button>`).join('')}</div>`;
}

function bindSetChips(rerender) {
  app.querySelectorAll('[data-set]').forEach(b => b.onclick = () => {
    try { localStorage.setItem('set', b.dataset.set); } catch {}
    rerender(b.dataset.set);
  });
}

const pct = (m, a) => (!a ? '–' : m === a ? '100' : (m / a * 100).toFixed(1));
const per = (v, gp) => (gp ? (v / gp).toFixed(1) : '–');

// NBA efficiency: PTS + REB + AST + STL + BLK − missed FG − missed FT − TO, per game.
const eff = p => (p.pts + p.reb + p.ast + p.stl + p.blk - (p.fga - p.fgm) - (p.fta - p.ftm) - p.to) / p.gp;

// Consistency: sample standard deviation of a player's per-game EFF, from
// the sum of squared game EFFs (e2) the data builder keeps. Needs 2+ games.
const effSd = p => (p.gp < 2 || p.e2 == null ? NaN
  : Math.sqrt(Math.max(0, (p.e2 - p.gp * eff(p) ** 2) / (p.gp - 1))));

// Leader categories. Qualification follows the NBA's rules, prorated to
// games played so far: 70% of team games for per-game stats, plus a
// minimum number of makes for percentages (300 FG, 82 3P, 125 FT over 82 games).
const LEADERS = [
  { id: 'eff', label: 'EFF', val: eff },
  { id: 'pts', label: 'PTS', val: p => p.pts / p.gp },
  { id: 'reb', label: 'REB', val: p => p.reb / p.gp },
  { id: 'ast', label: 'AST', val: p => p.ast / p.gp },
  { id: 'stl', label: 'STL', val: p => p.stl / p.gp },
  { id: 'blk', label: 'BLK', val: p => p.blk / p.gp },
  { id: 'tpm', label: '3PM', val: p => p.tpm / p.gp },
  { id: 'fgp', label: 'FG%', val: p => p.fgm / p.fga * 100, min: (p, g) => p.fgm >= 300 * g / 82 },
  { id: 'tpp', label: '3P%', val: p => p.tpm / p.tpa * 100, min: (p, g) => p.tpm >= 82 * g / 82 },
  { id: 'ftp', label: 'FT%', val: p => p.ftm / p.fta * 100, min: (p, g) => p.ftm >= 125 * g / 82 },
];

const SUM_KEYS = ['gp', 'e2', 'min', 'pm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];

// Combine stints for traded players; `t` is their most recent team.
function combinePlayers(stats) {
  const byPlayer = new Map();
  for (const s of Object.values(stats.players)) {
    const p = byPlayer.get(s.id);
    if (!p) { byPlayer.set(s.id, { ...s }); continue; }
    for (const k of SUM_KEYS) p[k] += s[k];
    p.t = s.t;
  }
  return byPlayer;
}

const teamGamesOf = stats => Math.max(0, ...Object.values(stats.teams).map(t => t.gp));
// The games-played minimum only applies once teams have played QUALIFY_FROM
// games; before that, missing one game would knock a player off every list.
const QUALIFY_FROM = 10;
const minGames = teamGames => (teamGames >= QUALIFY_FROM ? Math.ceil(teamGames * 0.7) : 1);
const qualifies = (p, cat, teamGames) => p.gp >= minGames(teamGames) && (!cat.min || cat.min(p, teamGames));

async function showLeaders(catId) {
  loading();
  const { sets, set } = await pickSet();
  if (!set) return setView('<p class="msg">No season data yet.</p>');
  const stats = await local(`data/${set.key}/stats.json`);
  if (!stats) return setView('<p class="msg">No season data yet.</p>');

  const cat = LEADERS.find(c => c.id === catId) || LEADERS[1];
  const teamGames = teamGamesOf(stats);
  const rows = [...combinePlayers(stats).values()]
    .filter(p => qualifies(p, cat, teamGames))
    .map(p => ({ p, v: cat.val(p) }))
    .filter(r => Number.isFinite(r.v))
    .sort((a, b) => b.v - a.v)
    .slice(0, 25);

  const body = rows.map((r, i) => {
    const t = stats.teams[r.p.t] || {};
    return `<tr class="link" data-player="${esc(r.p.id)}">
      <td class="rk">${i + 1}</td>
      <td class="tm">${esc(r.p.n)}<span class="sub">${esc(t.abbr)}</span></td>
      <td class="v">${r.v.toFixed(1)}</td>
      <td>${r.p.gp}</td></tr>`;
  }).join('');

  setView(`
    ${setChips(sets, set)}
    <div class="chips">${LEADERS.map(c =>
      `<button data-cat="${c.id}" class="${c.id === cat.id ? 'on' : ''}">${c.label}</button>`).join('')}</div>
    ${rows.length ? `
    <table class="tbl lead">
      <colgroup><col class="rk"><col><col class="v"><col class="gp"></colgroup>
      <thead><tr><th class="rk">#</th><th class="l">Player</th><th>${cat.label}</th><th>GP</th></tr></thead>
      <tbody>${body}</tbody>
    </table>` : '<p class="msg">No qualified players yet.</p>'}
    <p class="note">${esc(set.label)} · ${set.games} games · updated ${ago(stats.updated)}</p>`);
  app.querySelectorAll('[data-cat]').forEach(b =>
    b.onclick = () => { location.hash = '#/leaders/' + b.dataset.cat; });
  bindRows('player', id => '#/player/' + id);
  bindSetChips(() => showLeaders(cat.id));
}

// ---------- efficiency ----------

async function showEfficiency() {
  loading();
  const { sets, set } = await pickSet();
  const stats = set ? await local(`data/${set.key}/stats.json`) : null;
  if (!stats) return setView('<p class="msg">No season data yet.</p>');

  const teamGames = teamGamesOf(stats);
  const col = EFF_COLS[effSort];
  // Best first (lowest for `asc` columns); no value sorts last.
  const key = p => { const v = col.val(p); return Number.isFinite(v) ? (col.asc ? -v : v) : -Infinity; };
  const players = [...combinePlayers(stats).values()]
    .filter(p => qualifies(p, LEADERS[0], teamGames))
    .sort((a, b) => key(b) - key(a));

  const rows = players.map(p => `<tr class="link" data-player="${esc(p.id)}">
    <td>${esc(p.n)}</td>
    ${EFF_COLS.map(c => { const v = c.val(p); return `<td class="${c.label === 'EFF' ? 'v' : ''}">${c.fmt ? c.fmt(v, p) : v.toFixed(1)}</td>`; }).join('')}</tr>`).join('');

  setView(`
    ${setChips(sets, set)}
    ${players.length ? `
    <table class="tbl ps eff">
      <colgroup><col>${EFF_COLS.map(c => `<col class="${c.cls}">`).join('')}</colgroup>
      <thead><tr><th>Player</th>${EFF_COLS.map((c, i) =>
        `<th data-sort="${i}" class="${i === effSort ? 'on' : ''}">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>` : '<p class="msg">No qualified players yet.</p>'}
    <p class="note">${esc(set.label)} · per game · EFF = PTS + REB + AST + STL + BLK − missed FG − missed FT − TO · SD = how much EFF varies game to game (lower = more consistent) · ${minGames(teamGames) > 1 ? `players in ${minGames(teamGames)}+ games` : `all players until teams have played ${QUALIFY_FROM} games`} · tap a column to sort · updated ${ago(stats.updated)}</p>`);
  app.querySelectorAll('[data-sort]').forEach(th =>
    th.onclick = () => { effSort = +th.dataset.sort; showEfficiency(); });
  bindRows('player', id => '#/player/' + id);
  bindSetChips(showEfficiency);
}

// ---------- records ----------

// Single-game records, keyed like the season highs (scripts/build-data.mjs).
const RECORDS = [
  { id: 'pts', label: 'PTS' }, { id: 'reb', label: 'REB' }, { id: 'ast', label: 'AST' },
  { id: 'blk', label: 'BLK' }, { id: 'stl', label: 'STL' }, { id: 'fgm', label: 'FGM' },
  { id: 'tpm', label: '3PM' }, { id: 'ftm', label: 'FTM' }, { id: 'pm', label: '+/-' },
];

const shortDate = d => parseYmd(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

async function showRecords(catId) {
  loading();
  const { sets, set } = await pickSet();
  const [records, stats] = set
    ? await Promise.all([local(`data/${set.key}/records.json`), local(`data/${set.key}/stats.json`)])
    : [];
  if (!records) return setView('<p class="msg">No season data yet.</p>');

  const cat = RECORDS.find(c => c.id === catId) || RECORDS[0];
  const list = records[cat.id] || [];
  // Tied values share a rank.
  const body = list.map((r, i) => `
    <tr class="link" data-game="${esc(r.g)}">
      <td class="rk">${i && list[i - 1].v === r.v ? '' : i + 1}</td>
      <td class="tm">${playerLink(r.id, r.n)}<span class="sub">${esc(stats?.teams[r.t]?.abbr)}</span></td>
      <td class="v">${cat.id === 'pm' && r.v > 0 ? '+' : ''}${r.v}</td>
      <td>${esc(shortDate(r.d))}</td></tr>`).join('');

  setView(`
    ${setChips(sets, set)}
    <div class="chips">${RECORDS.map(c =>
      `<button data-cat="${c.id}" class="${c.id === cat.id ? 'on' : ''}">${c.label}</button>`).join('')}</div>
    ${list.length ? `
    <table class="tbl lead rec">
      <colgroup><col class="rk"><col><col class="v"><col class="dt"></colgroup>
      <thead><tr><th class="rk">#</th><th class="l">Player</th><th>${cat.label}</th><th>Date</th></tr></thead>
      <tbody>${body}</tbody>
    </table>` : '<p class="msg">No games played yet.</p>'}
    <p class="note">${esc(set.label)} · best single games · tap a row for the box score · updated ${ago(records.updated)}</p>`);
  app.querySelectorAll('[data-cat]').forEach(b =>
    b.onclick = () => { location.hash = '#/records/' + b.dataset.cat; });
  bindRows('game', id => '#/g/' + id);
  bindSetChips(() => showRecords(cat.id));
}

// ---------- player ----------

const athleteP = new Map();
function loadAthlete(id) {
  if (!athleteP.has(id)) {
    athleteP.set(id, getJSON(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}`)
      .then(d => d.athlete).catch(() => null));
  }
  return athleteP.get(id);
}

// Player page rows: the Leaders stats, then playing time, +/- and EFF.
const PLAYER_ROWS = [
  ...LEADERS.filter(c => c.id !== 'eff'),
  { id: 'gp', label: 'GP', val: p => p.gp, fmt: v => String(v) },
  { id: 'mpg', label: 'MPG', val: p => p.min / p.gp },
  { id: 'pm', label: '+/-', val: p => (p.pm == null ? NaN : p.pm / p.gp), fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) },
  LEADERS.find(c => c.id === 'eff'),
];

// Shows the remembered season set, or one the player has played in if they
// haven't played in that one (e.g. arriving from a preseason box score).
// Renders from our data first; ESPN's athlete profile (full name, headshot)
// fills in the header when it arrives.
// ---------- player game log ----------

// One small chart per stat, each scaled 0 to that stat's season best by
// anyone, in the validated categorical colors (style.css --s1…--s5).
const LOG_SERIES = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['blk', 'BLK'], ['stl', 'STL']];

// Game log rows from data/<set>/players/<id>.json, oldest first. Missed games
// keep their place (game number) with every stat 0 and dnp set.
function logRows(file) {
  return (file?.games || []).map(([g, d, t, opp, ha, res, score, oppScore, v], i) => {
    const r = { n: i + 1, g, d, t, opp, ha, res, score, oppScore, dnp: !v };
    file.keys.forEach((k, j) => { r[k] = v ? v[j] : 0; });
    return r;
  });
}

const LOG_H = 84;
const LOG_PAD = { l: 26, r: 8, t: 6, b: 6 };
const LOG_AXIS = 16; // game numbers under the last chart
const SHARE_W = 46; // the share-of-best figure right of each chart

// Share of the season best: the area under a stat's line over the games
// played, as a fraction of the area if every one of those games matched the
// season best. Counting each game as one value, that's simply the average
// per game played divided by the season best.
const shareOfBest = (rows, k, ymax) => {
  const played = rows.filter(g => !g.dnp);
  return played.length ? played.reduce((a, g) => a + g[k], 0) / played.length / ymax : 0;
};
const pct0 = f => `${Math.round(f * 100)}%`;

// Pentagon geometry: 0 at the center to 1 (the season best) at the rim.
function radarFrame(width) {
  const size = Math.min(width, 280), R = size / 2 - 46, cx = width / 2, cy = size / 2;
  const n = LOG_SERIES.length;
  const pt = (i, f) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
  };
  const poly = fs => LOG_SERIES.map((_, i) => pt(i, typeof fs === 'number' ? fs : fs[i]).map(v => v.toFixed(1)).join(',')).join(' ');
  const grid = [0.25, 0.5, 0.75, 1].map(f => `<polygon class="ring${f === 1 ? ' rim' : ''}" points="${poly(f)}"/>`).join('')
    + LOG_SERIES.map((_, i) => { const [x, y] = pt(i, 1); return `<line class="spoke" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`; }).join('');
  const label = (i, html) => {
    const [x, y] = pt(i, 1.2);
    const anchor = Math.abs(x - cx) < 2 ? 'middle' : x > cx ? 'start' : 'end';
    return `<text class="rl" x="${x}" y="${y + 4}" text-anchor="${anchor}">${html}</text>`;
  };
  return { size, cx, pt, poly, grid, label };
}

// Player page: the player's five shares, each axis keyed to its chart's color.
function shareRadar(shares, width) {
  const { size, pt, poly, grid, label } = radarFrame(width);
  const shape = poly(shares);
  const dots = LOG_SERIES.map((_, i) => { const [x, y] = pt(i, shares[i]); return `<circle class="dot s${i + 1}" cx="${x}" cy="${y}" r="4"/>`; }).join('');
  const labels = LOG_SERIES.map(([, name], i) =>
    label(i, `<tspan class="rk s${i + 1}">●</tspan> ${name} <tspan class="rv">${pct0(shares[i])}</tspan>`)).join('');
  return `
    <svg class="radar" width="${width}" height="${size}" role="img" aria-label="Share of the season best per stat: ${
      LOG_SERIES.map(([, label], i) => `${label} ${pct0(shares[i])}`).join(', ')}">
      ${grid}<polygon class="shape" points="${shape}"/>${dots}${labels}
    </svg>`;
}

// `best` maps stat -> the league's best single game this season, so a stat's
// chart is on the same scale for every player.
function logCharts(rows, fullWidth, best) {
  if (!rows.length || fullWidth < 200) return '';
  const width = fullWidth - SHARE_W;
  const N = rows.length;
  const { l, r, t: top, b } = LOG_PAD;
  const pw = width - l - r, ph = LOG_H - top - b;
  const x = n => (N === 1 ? l + pw / 2 : l + (n - 1) / (N - 1) * pw);
  const slot = N > 1 ? pw / (N - 1) : pw;
  const every = Math.ceil(N / 8);
  const ymaxes = LOG_SERIES.map(([k]) => Math.max(1, best?.[k] || 0, ...rows.map(g => g[k])));
  const shares = LOG_SERIES.map(([k], i) => shareOfBest(rows, k, ymaxes[i]));

  const charts = LOG_SERIES.map(([k, label], si) => {
    const ymax = ymaxes[si];
    const y = v => top + (1 - v / ymax) * ph;
    const last = si === LOG_SERIES.length - 1;
    const h = LOG_H + (last ? LOG_AXIS : 0);
    // 0, the season best, and a rounded midpoint when there's room.
    const ticks = [0, ymax];
    if (ymax >= 6) ticks.push(Math.round(ymax / 2));
    const grid = ticks.map(v => `<line class="${v ? 'g' : 'zero'}" x1="${l}" x2="${width - r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="tk" x="${l - 5}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`).join('');
    const xs = last ? rows.filter(g => (g.n - 1) % every === 0 || g.n === N)
      .map(g => `<text class="tk" x="${x(g.n)}" y="${h - 3}" text-anchor="middle">${g.n}</text>`).join('') : '';
    // Missed games: a faint band, and the line breaks there.
    const bands = rows.filter(g => g.dnp).map(g =>
      `<rect class="dnpband" x="${x(g.n) - slot / 2}" y="${top}" width="${slot}" height="${ph}"/>`).join('');
    let d = '', dots = '';
    rows.forEach((g, i) => {
      if (g.dnp) return;
      const prevPlayed = i > 0 && !rows[i - 1].dnp, nextPlayed = i < N - 1 && !rows[i + 1].dnp;
      d += `${prevPlayed ? 'L' : 'M'}${x(g.n).toFixed(1)},${y(g[k]).toFixed(1)}`;
      // Dots where a line alone can't show the game: short logs, or a game between misses.
      if (N <= 12 || (!prevPlayed && !nextPlayed)) dots += `<circle class="dot" cx="${x(g.n)}" cy="${y(g[k])}" r="4"/>`;
    });
    return `
      <div class="lc s${si + 1}" data-k="${k}">
        <div class="lchead"><span>${label}</span><b class="val"></b></div>
        <div class="lcbody">
        <svg width="${width}" height="${h}" role="img" aria-label="${label} by game">
          ${bands}${grid}${xs}<path class="ln" d="${d}"/>${dots}
          <line class="xh" x1="0" x2="0" y1="${top}" y2="${LOG_H - b}" visibility="hidden"/>
          <circle class="hdot" r="5" visibility="hidden"/>
        </svg>
        <div class="share" title="Average per game played ÷ season best">${pct0(shares[si])}</div>
        </div>
      </div>`;
  }).join('');
  return `
    <h2>Share of season best</h2>
    ${shareRadar(shares, fullWidth)}
    <p class="note radarnote">Average per game played ÷ the season's best single game by anyone (${
      LOG_SERIES.map(([, label], i) => `${label} ${ymaxes[i]}`).join(', ')}). 100% = matching the best every game.</p>
    <h2>By game</h2>
    <div class="logcharts" data-ymax="${ymaxes.join(',')}">
    <div class="lcgame">Tap or drag a chart to see a game</div>${charts}</div>`;
}

// One crosshair across all five charts: snaps to the nearest game, shows each
// stat's value in its chart's title row and the game above the charts.
function bindLogCharts(rows) {
  const box = app.querySelector('.logcharts');
  if (!box) return;
  const N = rows.length;
  const ymax = box.dataset.ymax.split(',').map(Number);
  const charts = [...box.querySelectorAll('.lc')];
  const pw = charts[0].querySelector('svg').width.baseVal.value - LOG_PAD.l - LOG_PAD.r;
  const ph = LOG_H - LOG_PAD.t - LOG_PAD.b;
  const label = box.querySelector('.lcgame');
  const show = g => {
    const cx = N === 1 ? LOG_PAD.l + pw / 2 : LOG_PAD.l + (g.n - 1) / (N - 1) * pw;
    label.textContent = `Game ${g.n} · ${shortDate(g.d)} ${g.ha} ${g.opp}${g.dnp ? ' · did not play' : ''}`;
    charts.forEach((c, i) => {
      const k = c.dataset.k;
      const xh = c.querySelector('.xh'), dot = c.querySelector('.hdot');
      xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
      c.querySelector('.val').textContent = g.dnp ? '–' : g[k];
      dot.setAttribute('visibility', g.dnp ? 'hidden' : 'visible');
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', LOG_PAD.t + (1 - g[k] / ymax[i]) * ph);
    });
  };
  const hide = () => {
    label.textContent = 'Tap or drag a chart to see a game';
    charts.forEach(c => {
      c.querySelector('.xh').setAttribute('visibility', 'hidden');
      c.querySelector('.hdot').setAttribute('visibility', 'hidden');
      c.querySelector('.val').textContent = '';
    });
  };
  for (const c of charts) {
    const svg = c.querySelector('svg');
    svg.addEventListener('pointermove', e => {
      const px = e.clientX - svg.getBoundingClientRect().left - LOG_PAD.l;
      show(rows[N === 1 ? 0 : Math.max(0, Math.min(N - 1, Math.round(px / pw * (N - 1))))]);
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointercancel', hide);
  }
}

// Game log table, most recent first. Rows open the box score.
const LOG_COLS = [
  { label: 'PTS', cls: 'pts', v: g => g.pts },
  { label: 'REB', cls: 's', v: g => g.reb },
  { label: 'AST', cls: 's', v: g => g.ast },
  { label: 'BLK', cls: 's', v: g => g.blk },
  { label: 'STL', cls: 's', v: g => g.stl },
  { label: 'FG', cls: 'sh', v: g => `${g.fgm}-${g.fga}` },
  { label: '3P', cls: 'sh', v: g => `${g.tpm}-${g.tpa}` },
  { label: 'FT', cls: 'sh', v: g => `${g.ftm}-${g.fta}` },
  { label: 'TO', cls: 's', v: g => g.to },
  { label: 'MIN', cls: 'min', v: g => g.min },
  { label: '+/-', cls: 'pm', v: g => (g.pm > 0 ? '+' : '') + g.pm },
];

function logTable(rows) {
  const body = [...rows].reverse().map(g => `
    <tr class="link ${g.dnp ? 'dnp' : ''}" data-game="${esc(g.g)}">
      <td><span class="opp">${esc(g.ha)} ${esc(g.opp)}</span><span class="when">${esc(shortDate(g.d))}${g.res ? ` · ${g.res} ${g.score}-${g.oppScore}` : ''}</span></td>
      ${LOG_COLS.map(c => `<td class="${c.label === '+/-' && g.pm ? (g.pm > 0 ? 'pos' : 'neg') : ''}">${esc(c.v(g))}</td>`).join('')}</tr>`).join('');
  return `
    <h2>Game log</h2>
    <table class="box gamelog">
      <colgroup><col class="n">${LOG_COLS.map(c => `<col class="${c.cls}">`).join('')}</colgroup>
      <thead><tr><th></th>${LOG_COLS.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="note">Most recent first · tap a game for its box score${rows.some(g => g.dnp) ? ' · grayed out = did not play' : ''}</p>`;
}

async function showPlayer(id, setKey) {
  loading();
  const here = location.hash;
  const { sets, set: picked } = await pickSet();
  const allStats = await Promise.all(sets.map(s => local(`data/${s.key}/stats.json`)));
  const has = i => allStats[i] && Object.values(allStats[i].players).some(p => p.id === id);
  let i = sets.findIndex(s => s.key === setKey);
  if (i < 0) {
    i = sets.indexOf(picked);
    if (!has(i)) i = sets.map((s, j) => j).reverse().find(has) ?? i;
  }
  const set = sets[i];
  const stats = allStats[i];
  if (location.hash !== here) return;

  const players = stats ? combinePlayers(stats) : new Map();
  const p = players.get(id);
  const team = p ? stats.teams[p.t] : null;
  const [logFile, highs] = p
    ? await Promise.all([local(`data/${set.key}/players/${id}.json`), local(`data/${set.key}/highs.json`)])
    : [];
  const rows = logRows(logFile);
  if (location.hash !== here) return;

  let table = `<p class="msg">No ${esc(set?.label?.toLowerCase() || 'season')} games played yet.</p>`;
  if (p) {
    const teamGames = teamGamesOf(stats);
    const all = [...players.values()];
    // Rank = 1 + qualified players ahead of them, so non-qualifiers still
    // get the spot they'd hold (marked *).
    const rank = (cat, pool, v) => {
      const vals = pool.filter(q => qualifies(q, cat, teamGames)).map(cat.val).filter(Number.isFinite);
      return { r: 1 + vals.filter(x => x > v).length };
    };
    const rankCell = (x, ok) => `${x.r}${ok ? '' : '*'}`;
    const rows = PLAYER_ROWS.map(cat => {
      const v = cat.val(p);
      if (!Number.isFinite(v)) return `<tr><td class="l">${cat.label}</td><td class="v">–</td><td>–</td><td>–</td></tr>`;
      const ok = qualifies(p, cat, teamGames);
      return `<tr><td class="l">${cat.label}</td><td class="v">${cat.fmt ? cat.fmt(v) : v.toFixed(1)}</td>
        <td>${rankCell(rank(cat, all, v), ok)}</td>
        <td>${rankCell(rank(cat, all.filter(q => q.t === p.t), v), ok)}</td></tr>`;
    }).join('');
    table = `
      <table class="tbl prank">
        <colgroup><col><col class="v"><col class="r"><col class="r"></colgroup>
        <thead><tr><th class="l">Stat</th><th></th><th>League</th><th>${esc(team?.abbr || 'Team')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">${esc(set.label)} · ranked among qualified players (same rules as Leaders)${
        PLAYER_ROWS.some(c => !qualifies(p, c, teamGames)) ? ' · * not qualified, shows where they would rank' : ''}</p>`;
  }

  const head = ath => {
    const meta = [team?.name || ath?.team?.displayName, ath?.jersey && '#' + ath.jersey, ath?.position?.abbreviation]
      .filter(Boolean).join(' · ');
    return `
      <img class="${ath?.headshot ? 'face' : ''}" src="${esc(ath?.headshot?.href || team?.logo || '')}" alt="">
      <div><div class="nm">${esc(ath?.displayName || p?.n || 'Player')}</div>
        <div class="rec">${p ? `<a href="#/team/${esc(p.t)}">${esc(meta)}</a>` : esc(meta)}</div></div>`;
  };
  setView(`
    <div class="teamhead">${head(null)}</div>
    ${set ? setChips(sets, set) : ''}
    ${table}
    ${rows.length ? `${logCharts(rows, Math.min(app.clientWidth || window.innerWidth, 760) - 12, Object.fromEntries(LOG_SERIES.map(([k]) => [k, highs?.league?.[k]?.v])))}${logTable(rows)}` : ''}`);
  bindSetChips(key => showPlayer(id, key));
  bindLogCharts(rows);
  bindRows('game', g => '#/g/' + g);
  const ath = await loadAthlete(id);
  const el = app.querySelector('.teamhead');
  if (ath && location.hash === here && el) el.innerHTML = head(ath);
}

// ---------- teams ----------

// Team stats columns: per game unless noted. `asc` = lower is better.
const TEAMS_COLS = [
  { label: 'W-L', cls: 'wl', val: t => (t.w + t.l ? t.w / (t.w + t.l) : 0), fmt: (v, t) => `${t.w}-${t.l}` },
  { label: 'PTS', cls: 'a', val: t => t.pts / t.gp },
  { label: 'OPP', cls: 'a', val: t => t.opp / t.gp, asc: true },
  { label: 'DIFF', cls: 'a', val: t => (t.pts - t.opp) / t.gp, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) },
  { label: 'REB', cls: 'a', val: t => t.reb / t.gp },
  { label: 'AST', cls: 'a', val: t => t.ast / t.gp },
  { label: 'STL', cls: 'b', val: t => t.stl / t.gp },
  { label: 'BLK', cls: 'b', val: t => t.blk / t.gp },
  { label: 'TO', cls: 'b', val: t => t.to / t.gp, asc: true },
  { label: 'FG%', cls: 'pc', val: t => (t.fga ? t.fgm / t.fga * 100 : -1), fmt: (v, t) => pct(t.fgm, t.fga) },
  { label: '3P%', cls: 'pc', val: t => (t.tpa ? t.tpm / t.tpa * 100 : -1), fmt: (v, t) => pct(t.tpm, t.tpa) },
  { label: 'FT%', cls: 'pc', val: t => (t.fta ? t.ftm / t.fta * 100 : -1), fmt: (v, t) => pct(t.ftm, t.fta) },
];

let teamsSort = 1; // PTS

async function showTeams() {
  loading();
  const { sets, set } = await pickSet();
  const stats = set ? await local(`data/${set.key}/stats.json`) : null;
  const teams = stats ? Object.entries(stats.teams).map(([id, t]) => ({ id, ...t })).filter(t => t.gp && t.pts != null) : [];
  if (!teams.length) return setView('<p class="msg">No season data yet.</p>');

  const col = TEAMS_COLS[teamsSort];
  teams.sort((a, b) => (col.asc ? col.val(a) - col.val(b) : col.val(b) - col.val(a)));
  const rows = teams.map(t => `<tr class="link" data-team="${esc(t.id)}">
    <td class="tm"><img src="${esc(t.logo)}" alt="" loading="lazy">${esc(t.abbr)}</td>
    ${TEAMS_COLS.map(c => { const v = c.val(t); return `<td class="${c.label === 'DIFF' && v ? (v > 0 ? 'pos' : 'neg') : ''}">${c.fmt ? c.fmt(v, t) : v.toFixed(1)}</td>`; }).join('')}</tr>`).join('');

  setView(`
    ${setChips(sets, set)}
    <div class="hscroll"><table class="tbl ps tstats">
      <colgroup><col class="tmc">${TEAMS_COLS.map(c => `<col class="${c.cls}">`).join('')}</colgroup>
      <thead><tr><th>Team</th>${TEAMS_COLS.map((c, i) =>
        `<th data-sort="${i}" class="${i === teamsSort ? 'on' : ''}">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="note">${esc(set.label)} · per game · OPP = points allowed · tap a column to sort, a team for its players · updated ${ago(stats.updated)}</p>`);
  app.querySelectorAll('[data-sort]').forEach(th =>
    th.onclick = () => { teamsSort = +th.dataset.sort; showTeams(); });
  bindRows('team', id => '#/team/' + id);
  bindSetChips(showTeams);
}

// Team player stats columns: per game unless noted.
const TEAM_COLS = [
  { label: 'GP', cls: 'gp', val: p => p.gp, fmt: v => v },
  { label: 'MIN', cls: 'm', val: p => p.min / p.gp, fmt: v => Math.round(v) },
  { label: 'PTS', cls: 'a', val: p => p.pts / p.gp },
  { label: 'REB', cls: 'a', val: p => p.reb / p.gp },
  { label: 'AST', cls: 'a', val: p => p.ast / p.gp },
  { label: 'STL', cls: 'b', val: p => p.stl / p.gp },
  { label: 'BLK', cls: 'b', val: p => p.blk / p.gp },
  { label: 'TO', cls: 'b', val: p => p.to / p.gp },
  { label: 'FG%', cls: 'pc', val: p => (p.fga ? p.fgm / p.fga * 100 : -1), fmt: (v, p) => pct(p.fgm, p.fga) },
  { label: '3P%', cls: 'pc', val: p => (p.tpa ? p.tpm / p.tpa * 100 : -1), fmt: (v, p) => pct(p.tpm, p.tpa) },
  { label: 'FT%', cls: 'pc', val: p => (p.fta ? p.ftm / p.fta * 100 : -1), fmt: (v, p) => pct(p.ftm, p.fta) },
];

let teamSort = 2; // PTS

// Efficiency tab: everyone listed meets the games minimum, so skip GP and MIN to fit a phone.
const EFF_COLS = [...TEAM_COLS.slice(2), { label: 'EFF', cls: 'e', val: eff },
  { label: 'SD', cls: 'sd', val: effSd, fmt: v => (Number.isFinite(v) ? v.toFixed(1) : '–'), asc: true }];
let effSort = EFF_COLS.length - 2; // EFF

async function showTeam(id) {
  loading();
  const [{ sets, set }, standings] = await Promise.all([pickSet(), loadStandings().catch(() => null)]);
  const entry = standings?.children.flatMap(c => c.standings.entries).find(e => e.team.id === id);
  const [stats, highs] = set
    ? await Promise.all([local(`data/${set.key}/stats.json`), local(`data/${set.key}/highs.json`)])
    : [];
  const best = Object.fromEntries(LOG_SERIES.map(([k]) => [k, highs?.league?.[k]?.v]));
  const t = entry?.team || {};
  const info = stats?.teams[id] || {};
  const name = t.displayName || info.name || 'Team';
  const logo = t.logos?.[0]?.href || info.logo || '';
  const rec = entry ? `${statVal(entry, 'wins')}-${statVal(entry, 'losses')} · ${statVal(entry, 'streak')}` : '';

  const players = stats ? Object.values(stats.players).filter(p => p.t === id) : [];
  const col = TEAM_COLS[teamSort];
  players.sort((a, b) => col.val(b) - col.val(a));

  const rows = players.map(p => `<tr><td>${playerLink(p.id, p.n)}</td>${TEAM_COLS.map(c => {
    const v = c.val(p);
    return `<td>${c.fmt ? c.fmt(v, p) : v.toFixed(1)}</td>`;
  }).join('')}</tr>`).join('');

  setView(`
    <div class="teamhead"><img src="${esc(logo)}" alt="">
      <div><div class="nm">${esc(name)}</div><div class="rec">${esc(rec)}</div></div></div>
    ${set ? setChips(sets, set) : ''}
    ${players.length ? `
    <table class="tbl ps">
      <colgroup><col>${TEAM_COLS.map(c => `<col class="${c.cls}">`).join('')}</colgroup>
      <thead><tr><th>Player</th>${TEAM_COLS.map((c, i) =>
        `<th data-sort="${i}" class="${i === teamSort ? 'on' : ''}">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note">${esc(set.label)} · per game · tap a column to sort · updated ${ago(stats.updated)}</p>
    ${teamRadar(players, best, Math.min(app.clientWidth || window.innerWidth, 760) - 12)}`
    : `<p class="msg">No ${esc(set?.label?.toLowerCase() || 'season')} games played yet.</p>`}`);
  app.querySelectorAll('[data-sort]').forEach(th =>
    th.onclick = () => { teamSort = +th.dataset.sort; showTeam(id); });
  bindTeamRadar();
  bindSetChips(() => showTeam(id));
}

// ---------- team radar ----------

// The team's top players by minutes per game, one color each. Eight is the
// most the categorical palette can tell apart; with shapes overlapping even
// that needs the tap-to-highlight, which also shows the player's numbers.
const TEAM_RADAR_MAX = 8;

function teamRadar(players, best, width) {
  const top = players.filter(p => p.gp).sort((a, b) => b.min / b.gp - a.min / a.gp).slice(0, TEAM_RADAR_MAX);
  if (top.length < 2 || width < 200) return '';
  const { size, poly, grid, label } = radarFrame(width);
  const shares = top.map(p => LOG_SERIES.map(([k]) => Math.min(1, p[k] / p.gp / Math.max(1, best[k] || 0))));
  const shapes = top.map((p, i) => `<polygon class="tshape c${i + 1}" data-i="${i}" points="${poly(shares[i])}"/>`).join('');
  const labels = LOG_SERIES.map(([, name], i) => label(i, `${name} <tspan class="rv" data-axis="${i}"></tspan>`)).join('');
  return `
    <h2>Share of season best</h2>
    <svg class="radar team" width="${width}" height="${size}" data-shares="${esc(JSON.stringify(shares))}" role="img" aria-label="Share of the season best per stat for the team's top players">
      ${grid}${shapes}${labels}
    </svg>
    <div class="chips radarkey">${top.map((p, i) =>
      `<button data-hi="${i}"><i class="c${i + 1}"></i>${esc(p.n)}</button>`).join('')}</div>
    <p class="note radarnote">Average per game played ÷ the season's best single game by anyone (${
      LOG_SERIES.map(([k, name]) => `${name} ${best[k] || '–'}`).join(', ')}). Top ${top.length} by minutes · tap a player to highlight.</p>`;
}

// Tap a player to bring their shape forward and label the corners with their
// numbers; tap again to show everyone.
function bindTeamRadar() {
  const svg = app.querySelector('.radar.team');
  if (!svg) return;
  const shares = JSON.parse(svg.dataset.shares);
  let hi = -1;
  const draw = () => {
    svg.classList.toggle('hasHi', hi >= 0);
    svg.querySelectorAll('.tshape').forEach(sh => {
      sh.classList.toggle('on', +sh.dataset.i === hi);
      if (+sh.dataset.i === hi) svg.insertBefore(sh, svg.querySelector('.rl'));
    });
    svg.querySelectorAll('[data-axis]').forEach(t => { t.textContent = hi >= 0 ? pct0(shares[hi][+t.dataset.axis]) : ''; });
    app.querySelectorAll('[data-hi]').forEach(b => b.classList.toggle('on', +b.dataset.hi === hi));
  };
  app.querySelectorAll('[data-hi]').forEach(b => b.onclick = () => { hi = hi === +b.dataset.hi ? -1 : +b.dataset.hi; draw(); });
}

// ---------- routing ----------

const TABS = [
  { id: 'games', href: '#/', label: 'Games', icon: '<path d="M4 5h16v15H4zM4 9h16M8 3v4M16 3v4"/>' },
  { id: 'standings', href: '#/standings', label: 'Standings', icon: '<path d="M5 20V10M12 20V4M19 20v-7"/>' },
  { id: 'leaders', href: '#/leaders', label: 'Leaders', icon: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>' },
  { id: 'eff', href: '#/eff', label: 'Efficiency', icon: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>' },
  { id: 'records', href: '#/records', label: 'Records', icon: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>' },
  { id: 'teams', href: '#/teams', label: 'Teams', icon: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M15 20a4.5 4.5 0 0 1 6.5-4"/>' },
];

const nav = document.createElement('nav');
nav.className = 'tabs';
nav.innerHTML = TABS.map(t => `<a href="${t.href}" data-tab="${t.id}">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>${t.label}</a>`).join('');
document.body.append(nav);

function route() {
  const [, kind, arg] = location.hash.split('/');
  const tab = { g: 'games', d: 'games', standings: 'standings', leaders: 'leaders', eff: 'eff', records: 'records', teams: 'teams', team: 'teams', player: '' }[kind] ?? 'games';
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));

  if (kind === 'g' && arg) {
    if (boxState?.id === arg) renderGame(); else showGame(arg);
  } else if (kind === 'd' && /^\d{8}$/.test(arg)) {
    showGames(arg);
  } else if (kind === 'standings') {
    showStandings();
  } else if (kind === 'leaders') {
    showLeaders(arg);
  } else if (kind === 'eff') {
    showEfficiency();
  } else if (kind === 'records') {
    showRecords(arg);
  } else if (kind === 'player' && arg) {
    showPlayer(arg);
  } else if (kind === 'teams') {
    showTeams();
  } else if (kind === 'team' && arg) {
    showTeam(arg);
  } else {
    showGames(addDays(ymd(new Date()), -1));
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
// The game flow chart is drawn at the screen's width.
let resizeQueued = false;
window.addEventListener('resize', () => {
  if (resizeQueued || !location.hash.startsWith('#/g/') || !boxState) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; if (location.hash.startsWith('#/g/') && boxState) renderGame(); });
});
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
