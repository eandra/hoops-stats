#!/usr/bin/env node
// Builds the static data the app can't get cheaply from ESPN:
//   data/index.json                    – which season sets exist
//   data/<year>-<type>/stats.json      – per-player season totals (leaders, team stats)
//   data/<year>-<type>/highs.json      – current per-player and league single-game highs
//   data/<year>-<type>/flags/<id>.json – which stats were season highs in that game
//   data/<year>-<type>/state.json      – processed game ids (internal)
//
// Incremental: each run only fetches box scores of games not yet processed.
// Games are processed in start-time order so "season high" means
// "as of that game". Node 18+, no dependencies.
//
// Env overrides (for testing against a past season):
//   DATA_DIR=/tmp/x  SEASON_DATE=20251201  UNTIL=20251110

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
// ESPN rejects headless/bot user agents.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const TYPE_LABEL = { 1: 'Preseason', 2: 'Regular Season', 3: 'Playoffs', 5: 'Play-In' };

// Stats tracked for season highs, in this order everywhere.
export const HIGH_KEYS = ['pts', 'reb', 'ast', 'blk', 'stl', 'pm', 'fgm', 'tpm', 'ftm'];

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

// Load (or start) the accumulated data for one season set.
async function loadSet(key) {
  const dir = join(ROOT, key);
  return {
    key, dir,
    state: await readJSON(join(dir, 'state.json'), { processed: [], firstDate: null }),
    stats: await readJSON(join(dir, 'stats.json'), { teams: {}, players: {} }),
    highs: await readJSON(join(dir, 'highs.json'), { players: {}, league: {} }),
  };
}

function processGame(set, summary, gameId, date) {
  const flags = { p: {}, l: {} };
  // League flags only once there are games from an earlier day to compare with.
  const leagueReady = set.state.firstDate && set.state.firstDate < date;
  const lines = [];

  for (const block of summary.boxscore?.players || []) {
    const team = block.team;
    const st = block.statistics?.[0];
    if (!st) continue;
    const t = set.stats.teams[team.id] ||= { abbr: team.abbreviation, name: team.shortDisplayName || team.displayName, logo: team.logo, gp: 0 };
    t.gp++;
    for (const a of st.athletes || []) {
      if (a.didNotPlay || !a.stats?.length) continue;
      const line = parseLine(st.keys, a.stats);
      if (!line.min && !line.pts && !line.reb && !line.ast) continue;
      lines.push({ id: a.athlete.id, name: a.athlete.shortName || a.athlete.displayName, team: team.id, line });
    }
  }

  // Flags are computed against highs from previous games only, so every
  // player in this game is compared to the same baseline.
  for (const { id, line } of lines) {
    const prev = set.highs.players[id];
    HIGH_KEYS.forEach((k, i) => {
      const v = line[k];
      if (v <= 0) return;
      if (prev && v >= prev[i]) (flags.p[id] ||= []).push(k);
      const lg = set.highs.league[k];
      if (leagueReady && lg && v >= lg.v) (flags.l[id] ||= []).push(k);
    });
  }

  // Then fold this game into totals and highs.
  for (const { id, name, team, line } of lines) {
    const key = `${id}:${team}`;
    const p = set.stats.players[key] ||= { id, n: name, t: team, gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
    p.n = name;
    p.gp++;
    for (const k of ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta']) p[k] += line[k];

    const prev = set.highs.players[id];
    set.highs.players[id] = HIGH_KEYS.map((k, i) => prev ? Math.max(prev[i], line[k]) : line[k]);
    for (const k of HIGH_KEYS) {
      const lg = set.highs.league[k];
      if (!lg || line[k] > lg.v) set.highs.league[k] = { v: line[k], id, n: name, t: team, g: gameId, d: date };
    }
  }

  set.state.firstDate ||= date;
  set.state.processed.push(gameId);
  return flags;
}

async function main() {
  const board = await getJSON(`${API}/scoreboard${process.env.SEASON_DATE ? '?dates=' + process.env.SEASON_DATE : ''}`);
  const league = board.leagues[0];
  const year = league.season.year;
  const index = await readJSON(join(ROOT, 'index.json'), {});
  if (index.year !== year) Object.assign(index, { year, label: league.season.displayName, sets: {}, checked: [] });

  // Game days up to today that we haven't fully processed yet. The last two
  // checked days are always rechecked in case games finished after the last run.
  const today = process.env.UNTIL || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const days = (league.calendar || [])
    .map(d => (typeof d === 'string' ? d : d.startDate).slice(0, 10).replace(/-/g, ''))
    .filter(d => d <= today);
  const done = new Set(index.checked.slice(0, -2));
  const todo = days.filter(d => !done.has(d));

  const sets = {};
  const getSet = async key => (sets[key] ||= await loadSet(key));
  let added = 0;

  for (const day of todo) {
    const sb = await getJSON(`${API}/scoreboard?dates=${day}`);
    const events = (sb.events || []).sort((a, b) => a.date.localeCompare(b.date));
    let allFinal = true;
    for (const ev of events) {
      if (!ev.status.type.completed) { allFinal = false; continue; }
      const type = ev.season?.type ?? 2;
      const set = await getSet(`${year}-${type}`);
      if (set.state.processed.includes(ev.id)) continue;
      const summary = await getJSON(`${API}/summary?event=${ev.id}`);
      const flags = processGame(set, summary, ev.id, day);
      await writeJSON(join(set.dir, 'flags', `${ev.id}.json`), flags);
      index.sets[set.key] = { year, type, label: TYPE_LABEL[type] || 'Season', games: set.state.processed.length };
      added++;
      console.log(`${day} ${ev.shortName} -> ${set.key}`);
    }
    // Days in the past with every game final never need checking again.
    if (allFinal && day < today && !index.checked.includes(day)) index.checked.push(day);
  }

  for (const set of Object.values(sets)) {
    const updated = new Date().toISOString();
    await writeJSON(join(set.dir, 'state.json'), set.state);
    await writeJSON(join(set.dir, 'stats.json'), { ...set.stats, updated });
    await writeJSON(join(set.dir, 'highs.json'), { ...set.highs, keys: HIGH_KEYS, updated });
  }
  index.checked.sort();
  index.updated = new Date().toISOString();
  await writeJSON(join(ROOT, 'index.json'), index);
  console.log(`Processed ${added} new game(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
