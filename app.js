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

let boxState = null; // { id, data, side, flags }

async function showGame(id) {
  loading();
  try {
    const data = await getJSON(`${API}/summary?event=${id}`);
    boxState = { id, data, side: 0, flags: null };
    renderGame();
    boxState.flags = await loadFlags(id, data);
    if (boxState?.id === id && boxState.flags) renderGame();
  } catch (e) { fail(e); }
}

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

function renderGame() {
  const { data, side, flags } = boxState;
  const comp = data.header.competitions[0];
  const status = comp.status.type;
  const away = comp.competitors.find(t => t.homeAway === 'away');
  const home = comp.competitors.find(t => t.homeAway === 'home');
  const date = ymd(new Date(comp.date));

  const teamHead = t => `
    <a href="#/team/${t.team.id}" class="${status.completed && !t.winner ? 'loser' : ''}">
      <img src="${esc(t.team.logos?.[0]?.href || '')}" alt="">
      <div class="abbr">${esc(t.team.abbreviation)}</div>
      <div class="pts">${esc(t.score ?? '')}</div>
    </a>`;

  // Box score team blocks, ordered away then home to match the header.
  const players = [...(data.boxscore.players || [])].sort((a, b) =>
    (a.team.id === away.team.id ? -1 : 1));

  const tabs = players.map((p, i) =>
    `<button data-side="${i}" class="${i === side ? 'on' : ''}">${esc(p.team.abbreviation)}</button>`).join('');

  const tag = seasonTag(data.header.season?.type);
  setView(`
    <a class="back" href="#/d/${date}">‹ Games</a>
    <div class="scorehead">
      ${teamHead(away)}
      <div class="mid">${esc(status.shortDetail)}${tag ? `<div class="tag">${tag}</div>` : ''}</div>
      ${teamHead(home)}
    </div>
    ${players.length ? `<div class="teamtabs">${tabs}</div>${boxTable(players[side], flags)}
      <p class="legend"><span class="dot hi"></span>Player's season high · <span class="dot lhi"></span>League season high</p>`
                     : '<p class="msg">Box score not available yet.</p>'}
  `);
  app.querySelectorAll('[data-side]').forEach(b =>
    b.onclick = () => { boxState.side = +b.dataset.side; renderGame(); });
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

// Leader categories. Qualification follows the NBA's rules, prorated to
// games played so far: 70% of team games for per-game stats, plus a
// minimum number of makes for percentages (300 FG, 82 3P, 125 FT over 82 games).
// NBA efficiency: PTS + REB + AST + STL + BLK − missed FG − missed FT − TO, per game.
const eff = p => (p.pts + p.reb + p.ast + p.stl + p.blk - (p.fga - p.fgm) - (p.fta - p.ftm) - p.to) / p.gp;

// Consistency: sample standard deviation of a player's per-game EFF, from
// the sum of squared game EFFs (e2) the data builder keeps. Needs 2+ games.
const effSd = p => (p.gp < 2 || p.e2 == null ? NaN
  : Math.sqrt(Math.max(0, (p.e2 - p.gp * eff(p) ** 2) / (p.gp - 1))));

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

const SUM_KEYS = ['gp', 'e2', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];

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
const qualifies = (p, cat, teamGames) => p.gp >= Math.ceil(teamGames * 0.7) && (!cat.min || cat.min(p, teamGames));

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
    <p class="note">${esc(set.label)} · per game · EFF = PTS + REB + AST + STL + BLK − missed FG − missed FT − TO · SD = how much EFF varies game to game (lower = more consistent) · players in ${Math.ceil(teamGames * 0.7)}+ games · tap a column to sort · updated ${ago(stats.updated)}</p>`);
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

// Shows the remembered season set, or one the player has played in if they
// haven't played in that one (e.g. arriving from a preseason box score).
// Renders from our data first; ESPN's athlete profile (full name, headshot)
// fills in the header when it arrives.
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

  let table = `<p class="msg">No ${esc(set?.label?.toLowerCase() || 'season')} games played yet.</p>`;
  if (p) {
    const teamGames = teamGamesOf(stats);
    const all = [...players.values()];
    // Rank = 1 + qualified players ahead of them, so non-qualifiers still
    // get the spot they'd hold (marked *).
    const rank = (cat, pool, v) => {
      const vals = pool.filter(q => qualifies(q, cat, teamGames)).map(cat.val).filter(Number.isFinite);
      return { r: 1 + vals.filter(x => x > v).length, of: vals.length };
    };
    const rankCell = (x, ok) => `${x.r}${ok ? '' : '*'}<span class="sub">/ ${x.of}</span>`;
    const rows = LEADERS.map(cat => {
      const v = cat.val(p);
      if (!Number.isFinite(v)) return `<tr><td class="l">${cat.label}</td><td class="v">–</td><td>–</td><td>–</td></tr>`;
      const ok = qualifies(p, cat, teamGames);
      return `<tr><td class="l">${cat.label}</td><td class="v">${v.toFixed(1)}</td>
        <td>${rankCell(rank(cat, all, v), ok)}</td>
        <td>${rankCell(rank(cat, all.filter(q => q.t === p.t), v), ok)}</td></tr>`;
    }).join('');
    table = `
      <table class="tbl prank">
        <colgroup><col><col class="v"><col class="r"><col class="r"></colgroup>
        <thead><tr><th class="l">Per game</th><th></th><th>League</th><th>${esc(team?.abbr || 'Team')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">${esc(set.label)} · ${p.gp} GP · ${per(p.min, p.gp)} MIN · ranked among qualified players (same rules as Leaders)${
        LEADERS.some(c => !qualifies(p, c, teamGames)) ? ' · * not qualified, shows where they would rank' : ''}</p>`;
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
    ${table}`);
  bindSetChips(key => showPlayer(id, key));
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
  const stats = set ? await local(`data/${set.key}/stats.json`) : null;
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
    <p class="note">${esc(set.label)} · per game · tap a column to sort · updated ${ago(stats.updated)}</p>`
    : `<p class="msg">No ${esc(set?.label?.toLowerCase() || 'season')} games played yet.</p>`}`);
  app.querySelectorAll('[data-sort]').forEach(th =>
    th.onclick = () => { teamSort = +th.dataset.sort; showTeam(id); });
  bindSetChips(() => showTeam(id));
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
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
