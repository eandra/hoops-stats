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
      <p class="legend"><b>Bold</b> = player's season high · <u>Underlined</u> = league season high</p>`
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
    return `<td class="${cls.join(' ')}">${esc(v)}</td>`;
  }).join('');

  const row = a => {
    const name = a.athlete.shortName || a.athlete.displayName;
    const title = esc(a.athlete.displayName);
    if (!a.stats?.length || a.didNotPlay) {
      return `<tr class="dnp"><td title="${title}">${esc(name)}</td>
        <td class="why" colspan="${COLS.length}">DNP${a.reason ? ' – ' + esc(a.reason.toLowerCase()) : ''}</td></tr>`;
    }
    return `<tr><td title="${title}">${esc(name)}</td>${cells(a.stats, a.athlete.id)}</tr>`;
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
    rerender();
  });
}

const pct = (m, a) => (!a ? '–' : m === a ? '100' : (m / a * 100).toFixed(1));
const per = (v, gp) => (gp ? (v / gp).toFixed(1) : '–');

// Leader categories. Qualification follows the NBA's rules, prorated to
// games played so far: 70% of team games for per-game stats, plus a
// minimum number of makes for percentages (300 FG, 82 3P, 125 FT over 82 games).
const LEADERS = [
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

async function showLeaders(catId) {
  loading();
  const { sets, set } = await pickSet();
  if (!set) return setView('<p class="msg">No season data yet.</p>');
  const stats = await local(`data/${set.key}/stats.json`);
  if (!stats) return setView('<p class="msg">No season data yet.</p>');

  const cat = LEADERS.find(c => c.id === catId) || LEADERS[0];
  // Combine stints for traded players; show their most recent team.
  const byPlayer = new Map();
  for (const s of Object.values(stats.players)) {
    const p = byPlayer.get(s.id);
    if (!p) { byPlayer.set(s.id, { ...s }); continue; }
    for (const k of ['gp', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta']) p[k] += s[k];
    p.t = s.t;
  }
  const teamGames = Math.max(0, ...Object.values(stats.teams).map(t => t.gp));
  const rows = [...byPlayer.values()]
    .filter(p => p.gp >= Math.ceil(teamGames * 0.7) && (!cat.min || cat.min(p, teamGames)))
    .map(p => ({ p, v: cat.val(p) }))
    .filter(r => Number.isFinite(r.v))
    .sort((a, b) => b.v - a.v)
    .slice(0, 25);

  const body = rows.map((r, i) => {
    const t = stats.teams[r.p.t] || {};
    return `<tr class="link" data-team="${r.p.t}">
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
  app.querySelectorAll('[data-team]').forEach(r =>
    r.onclick = () => { location.hash = '#/team/' + r.dataset.team; });
  bindSetChips(() => showLeaders(cat.id));
}

// ---------- teams ----------

async function showTeams() {
  loading();
  try {
    const d = await loadStandings();
    setView(d.children.map(conf => {
      const teams = conf.standings.entries.map(e => e.team)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      return `<h2>${esc(conf.name)}</h2><div class="teamlist">${teams.map(t => `
        <a href="#/team/${t.id}"><img src="${esc(t.logos?.[0]?.href)}" alt="" loading="lazy">${esc(t.shortDisplayName)}</a>`).join('')}</div>`;
    }).join(''));
  } catch (e) { fail(e); }
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

  const rows = players.map(p => `<tr><td title="${esc(p.n)}">${esc(p.n)}</td>${TEAM_COLS.map(c => {
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
  { id: 'teams', href: '#/teams', label: 'Teams', icon: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M15 20a4.5 4.5 0 0 1 6.5-4"/>' },
];

const nav = document.createElement('nav');
nav.className = 'tabs';
nav.innerHTML = TABS.map(t => `<a href="${t.href}" data-tab="${t.id}">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>${t.label}</a>`).join('');
document.body.append(nav);

function route() {
  const [, kind, arg] = location.hash.split('/');
  const tab = { g: 'games', d: 'games', standings: 'standings', leaders: 'leaders', teams: 'teams', team: 'teams' }[kind] || 'games';
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));

  if (kind === 'g' && arg) {
    if (boxState?.id === arg) renderGame(); else showGame(arg);
  } else if (kind === 'd' && /^\d{8}$/.test(arg)) {
    showGames(arg);
  } else if (kind === 'standings') {
    showStandings();
  } else if (kind === 'leaders') {
    showLeaders(arg);
  } else if (kind === 'teams') {
    showTeams();
  } else if (kind === 'team' && arg) {
    showTeam(arg);
  } else {
    showGames(ymd(new Date()));
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
