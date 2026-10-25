#!/usr/bin/env node
// Builds the static data the app can't get cheaply from ESPN:
//   data/index.json                    – which season sets exist
//   data/<year>-<type>/stats.json      – per-player and per-team season totals
//   data/<year>-<type>/highs.json      – current per-player and league single-game highs
//   data/<year>-<type>/records.json    – top single-game lines per stat (records tab)
//   data/<year>-<type>/results.json    – each team's results in order (box score W-L and streak)
//   data/<year>-<type>/flags/<id>.json – which stats were season highs in that game
//   data/<year>-<type>/games/<id>.json – each game's parsed box score (internal)
//
// Each run fetches box scores of new games, and re-fetches the last
// RECHECK_DAYS days of games because ESPN sometimes corrects box scores
// after the fact. Everything else is then rebuilt from the saved games, in
// start-time order so "season high" means "as of that game", so a
// correction fixes totals, highs, records and flags alike.
// Node 18+, no dependencies.
//
// Env overrides (for testing against a past season):
//   DATA_DIR=/tmp/x  SEASON_DATE=20251201  UNTIL=20251110

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
// ESPN rejects headless/bot user agents.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const TYPE_LABEL = { 1: 'Preseason', 2: 'Regular Season', 3: 'Playoffs', 5: 'Play-In' };

// Stats tracked for season highs, in this order everywhere.
export const HIGH_KEYS = ['pts', 'reb', 'ast', 'blk', 'stl', 'pm', 'fgm', 'tpm', 'ftm'];
const RECORDS_TOP = 20;
// Bump when the published files gain a field, to rebuild every set once
// from its saved games.
const BUILD = 2;
const RECHECK_DAYS = 3; // today and the two days before
const LINE_KEYS = ['min', 'pm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];
const TEAM_KEYS = ['reb', 'oreb', 'ast', 'stl', 'blk', 'to', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function writeJSON(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const split = v => String(v ?? '').split('-').map(num);

// One player's line from an ESPN box score, keyed by our short names.
function parseLine(keys, stats) {
  const s = Object.fromEntries(keys.map((k, i) => [k, stats[i]]));
  const [fgm, fga] = split(s['fieldGoalsMade-fieldGoalsAttempted']);
  const [tpm, tpa] = split(s['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
  const [ftm, fta] = split(s['freeThrowsMade-freeThrowsAttempted']);
  return {
    min: num(s.minutes), pts: num(s.points), reb: num(s.rebounds), ast: num(s.assists),
    stl: num(s.steals), blk: num(s.blocks), to: num(s.turnovers), pm: num(s.plusMinus),
    fgm, fga, tpm, tpa, ftm, fta,
  };
}

// One game from an ESPN summary, reduced to what the builder needs.
// Teams are those with box score stats (as before, for games played).
function parseGame(summary, id, day) {
  const comps = summary.header?.competitions?.[0]?.competitors || [];
  const teams = [];
  const lines = [];
  for (const block of summary.boxscore?.players || []) {
    const team = block.team;
    const st = block.statistics?.[0];
    if (!st) continue;
    const me = comps.find(c => c.team.id === team.id);
    const them = comps.find(c => c.team.id !== team.id);
    const ts = summary.boxscore.teams?.find(x => x.team.id === team.id)?.statistics || [];
    const v = name => ts.find(x => x.name === name)?.displayValue;
    const [fgm, fga] = split(v('fieldGoalsMade-fieldGoalsAttempted'));
    const [tpm, tpa] = split(v('threePointFieldGoalsMade-threePointFieldGoalsAttempted'));
    const [ftm, fta] = split(v('freeThrowsMade-freeThrowsAttempted'));
    teams.push({
      id: team.id, abbr: team.abbreviation, name: team.shortDisplayName || team.displayName, logo: team.logo,
      pts: num(me?.score), opp: num(them?.score), w: !!me?.winner, l: !!them?.winner,
      // The team section includes team rebounds and turnovers.
      s: {
        reb: num(v('totalRebounds')), oreb: num(v('offensiveRebounds')), ast: num(v('assists')),
        stl: num(v('steals')), blk: num(v('blocks')), to: num(v('totalTurnovers') ?? v('turnovers')),
        fgm, fga, tpm, tpa, ftm, fta,
      },
    });
    for (const a of st.athletes || []) {
      if (a.didNotPlay || !a.stats?.length) continue;
      const line = parseLine(st.keys, a.stats);
      if (!line.min && !line.pts && !line.reb && !line.ast) continue;
      lines.push({ id: a.athlete.id, n: a.athlete.shortName || a.athlete.displayName, t: team.id, ...line });
    }
  }
  return { id, d: day, at: summary.header?.competitions?.[0]?.date || '', teams, lines };
}

// NBA efficiency for one game line.
const effOf = l => l.pts + l.reb + l.ast + l.stl + l.blk - (l.fga - l.fgm) - (l.fta - l.ftm) - l.to;

// Fold a game's lines into the per-stat top lists. Ties keep the earlier game.
function addRecords(records, g) {
  for (const k of HIGH_KEYS) {
    const list = records[k] ||= [];
    for (const l of g.lines) {
      const v = l[k];
      if (v <= 0 || (list.length >= RECORDS_TOP && v <= list[list.length - 1].v)) continue;
      list.push({ v, id: l.id, n: l.n, t: l.t, g: g.id, d: g.d });
      list.sort((a, b) => b.v - a.v || a.d.localeCompare(b.d) || a.g.localeCompare(b.g));
      list.length = Math.min(list.length, RECORDS_TOP);
    }
  }
}

// Everything published for a season set, from its saved games.
function build(games) {
  const stats = { teams: {}, players: {} };
  const highs = { players: {}, league: {} };
  const records = {};
  const flags = {};
  const results = {}; // team id -> [[game id, date, 'W' | 'L'], …] in game order
  let firstDate = null;
  const ordered = [...games.values()].sort((a, b) =>
    a.d.localeCompare(b.d) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

  for (const g of ordered) {
    // Flags are computed against highs from previous games only, so every
    // player in this game is compared to the same baseline. League flags
    // only once there are games from an earlier day to compare with.
    const f = flags[g.id] = { p: {}, l: {} };
    const leagueReady = firstDate && firstDate < g.d;
    for (const l of g.lines) {
      const prev = highs.players[l.id];
      HIGH_KEYS.forEach((k, i) => {
        const v = l[k];
        if (v <= 0) return;
        if (prev && v >= prev[i]) (f.p[l.id] ||= []).push(k);
        const lg = highs.league[k];
        if (leagueReady && lg && v >= lg.v) (f.l[l.id] ||= []).push(k);
      });
    }

    for (const t of g.teams) {
      const tt = stats.teams[t.id] ||= { abbr: t.abbr, name: t.name, logo: t.logo, gp: 0, w: 0, l: 0, pts: 0, opp: 0, ...Object.fromEntries(TEAM_KEYS.map(k => [k, 0])) };
      tt.gp++;
      tt.pts += t.pts; tt.opp += t.opp;
      if (t.w) tt.w++; else if (t.l) tt.l++;
      if (t.w || t.l) (results[t.id] ||= []).push([g.id, g.d, t.w ? 'W' : 'L']);
      for (const k of TEAM_KEYS) tt[k] += t.s[k];
    }

    // Then fold this game into totals and highs. Totals are per stint
    // (player:team) so traded players' teams stay right.
    for (const l of g.lines) {
      const p = stats.players[`${l.id}:${l.t}`] ||= { id: l.id, n: l.n, t: l.t, gp: 0, e2: 0, ...Object.fromEntries(LINE_KEYS.map(k => [k, 0])) };
      p.n = l.n;
      p.gp++;
      for (const k of LINE_KEYS) p[k] += l[k];
      p.e2 += effOf(l) ** 2;

      const prev = highs.players[l.id];
      highs.players[l.id] = HIGH_KEYS.map((k, i) => prev ? Math.max(prev[i], l[k]) : l[k]);
      for (const k of HIGH_KEYS) {
        const lg = highs.league[k];
        if (!lg || l[k] > lg.v) highs.league[k] = { v: l[k], id: l.id, n: l.n, t: l.t, g: g.id, d: g.d };
      }
    }

    addRecords(records, g);
    firstDate ||= g.d;
  }
  return { stats, highs, records, flags, results };
}

// Game date (US Eastern, like ESPN's scoreboard days) from a summary.
const summaryDate = summary => new Date(summary.header.competitions[0].date)
  .toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');

const ymdAdd = (s, n) => {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n));
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

// Saved games for one season set. Sets built before games were saved only
// have state.json's list of game ids: fetch those once to fill the cache.
async function loadSet(key) {
  const dir = join(ROOT, key);
  const games = new Map();
  const files = await readdir(join(dir, 'games')).catch(() => []);
  for (const f of files) {
    if (f.endsWith('.json')) { const g = await readJSON(join(dir, 'games', f)); games.set(g.id, g); }
  }
  const set = { key, dir, games, changed: false };
  const state = await readJSON(join(dir, 'state.json'), null);
  if (state) {
    for (const id of state.processed.filter(id => !games.has(id))) {
      const summary = await getJSON(`${API}/summary?event=${id}`);
      await saveGame(set, parseGame(summary, id, summaryDate(summary)));
    }
    await rm(join(dir, 'state.json'));
    set.changed = true;
    console.log(`Saved ${state.processed.length} existing game(s) for ${key}.`);
  }
  return set;
}

async function saveGame(set, g) {
  set.games.set(g.id, g);
  await writeJSON(join(set.dir, 'games', `${g.id}.json`), g);
}

async function main() {
  const board = await getJSON(`${API}/scoreboard${process.env.SEASON_DATE ? '?dates=' + process.env.SEASON_DATE : ''}`);
  const league = board.leagues[0];
  const year = league.season.year;
  const index = await readJSON(join(ROOT, 'index.json'), {});
  if (index.year !== year) Object.assign(index, { year, label: league.season.displayName, sets: {}, checked: [] });

  // Game days up to today that aren't done yet (some game wasn't final when
  // last checked), plus the recent days whose box scores may still be corrected.
  const today = process.env.UNTIL || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const recheckFrom = ymdAdd(today, 1 - RECHECK_DAYS);
  const days = (league.calendar || [])
    .map(d => (typeof d === 'string' ? d : d.startDate).slice(0, 10).replace(/-/g, ''))
    .filter(d => d <= today);
  const done = new Set(index.checked);
  const todo = days.filter(d => !done.has(d) || d >= recheckFrom);

  const sets = {};
  const getSet = async key => (sets[key] ||= await loadSet(key));
  for (const key of Object.keys(index.sets)) await getSet(key);
  if (index.build !== BUILD) {
    for (const set of Object.values(sets)) set.changed = true;
    index.build = BUILD;
  }
  let added = 0, corrected = 0;
  let changed = Object.values(sets).some(s => s.changed);

  for (const day of todo) {
    const sb = await getJSON(`${API}/scoreboard?dates=${day}`);
    let allFinal = true;
    for (const ev of sb.events || []) {
      if (!ev.status.type.completed) { allFinal = false; continue; }
      const type = ev.season?.type ?? 2;
      const set = await getSet(`${year}-${type}`);
      const old = set.games.get(ev.id);
      if (old && day < recheckFrom) continue;
      const g = parseGame(await getJSON(`${API}/summary?event=${ev.id}`), ev.id, day);
      if (old && JSON.stringify(old) === JSON.stringify(g)) continue;
      await saveGame(set, g);
      set.changed = true;
      index.sets[set.key] = { year, type, label: TYPE_LABEL[type] || 'Season', games: set.games.size };
      if (old) corrected++; else added++;
      console.log(`${day} ${ev.shortName} -> ${set.key}${old ? ' (box score corrected)' : ''}`);
    }
    // Days in the past with every game final only get rechecked while recent.
    if (allFinal && day < today && !done.has(day)) { index.checked.push(day); done.add(day); changed = true; }
  }

  for (const set of Object.values(sets)) {
    if (!set.changed) continue;
    const { stats, highs, records, flags, results } = build(set.games);
    const updated = new Date().toISOString();
    await writeJSON(join(set.dir, 'stats.json'), { ...stats, updated });
    await writeJSON(join(set.dir, 'highs.json'), { ...highs, keys: HIGH_KEYS, updated });
    await writeJSON(join(set.dir, 'records.json'), { ...records, keys: HIGH_KEYS, updated });
    await writeJSON(join(set.dir, 'results.json'), { teams: results, updated });
    for (const [id, f] of Object.entries(flags)) await writeJSON(join(set.dir, 'flags', `${id}.json`), f);
  }
  // Leave index.json alone when nothing changed, so quiet runs don't commit.
  if (changed || added || corrected) {
    index.checked.sort();
    index.updated = new Date().toISOString();
    await writeJSON(join(ROOT, 'index.json'), index);
  }
  console.log(`Processed ${added} new and ${corrected} corrected game(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
