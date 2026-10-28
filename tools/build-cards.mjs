#!/usr/bin/env node
/*
  build-cards.mjs — turns the spreadsheet export into assets/data/cards.json.

      node tools/build-cards.mjs                    reads notes/Commander Decks - Richard Garfield.csv
      node tools/build-cards.mjs path/to/other.csv

  Every card name is looked up on Scryfall (fuzzy, so typos survive) to get its
  mana value and image. Mana values come from Scryfall, not from the column a
  card sits in, so a card in the wrong column still lands under the right
  header. The page reads only the JSON; it never talks to Scryfall's API.

  The CSV has three shapes, told apart by the label in its second column:

    Ramp … Answers, Flashback   cards in any cell; grouped by mana value
    Combo                       the label row holds column headers; below it,
                                blank cells split a column into combo groups
                                (GROUPED columns only — the rest are flat lists)
*/

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = process.argv[2] ?? join(ROOT, 'notes/Commander Decks - Richard Garfield.csv');
const OUT = join(ROOT, 'assets/data/cards.json');

/* Page order. Combo is last on the page even though it is not last in the CSV. */
const SECTIONS = [
  { name: 'Ramp',       short: 'Ra' },
  { name: 'Draw',       short: 'Dr' },
  { name: 'Tutor',      short: 'Tu' },
  { name: 'Recur',      short: 'Re' },
  { name: 'Utility',    short: 'Ut' },
  { name: 'Protection', short: 'Pr' },
  { name: 'Answers',    short: 'An' },
  { name: 'Flashback',  short: 'Fb' },
  { name: 'Combo',      short: 'Co' },
];

/* Combo columns where a blank cell separates one combo from the next. */
const GROUPED = new Set(['Self-Contained', 'Infinite Mana']);

/* A combo column with cards but no header. */
const UNTITLED = 'Other';


/* ---- CSV ---------------------------------------------------------------- */

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* "[2U] Temporal Tribulation [4U]" → { name, cost: "2U" }; "Mox Lotus (UNH)" → set "unh" */
function parseCell(raw) {
  let text = raw.trim();
  if (!text) return null;
  const cost = text.match(/^\[([^\]]*)\]/)?.[1] ?? '';
  text = text.replace(/^\[[^\]]*\]\s*/, '').replace(/\s*\[[^\]]*\]$/, '');
  const set = text.match(/\(([A-Za-z0-9]{3,5})\)$/)?.[1]?.toLowerCase();
  if (set) text = text.replace(/\s*\([^)]*\)$/, '');
  return { name: text, cost, set };
}

/* Fallback mana value from the bracketed cost, for cells Scryfall can't find. */
function costToMv(cost) {
  let mv = 0;
  for (const part of cost.match(/\d+|[A-Z]/g) ?? []) mv += /\d/.test(part) ? Number(part) : 1;
  return mv;
}

function readSheet(rows) {
  const lists = new Map(SECTIONS.map((s) => [s.name, []]));   // name → cells, in reading order
  const combo = [];                                            // columns: { title, grouped, groups: [[cell]] }
  let section = null;

  for (const row of rows) {
    if (row[1]?.trim()) {
      section = row[1].trim();
      if (section === 'Combo') {
        row.slice(2).forEach((h, i) => {
          const title = h.replace(/^#\s*/, '').trim();
          combo[i] = { title, grouped: GROUPED.has(title), groups: [[]] };
        });
        continue;
      }
    }
    if (!section) continue;

    row.slice(2).forEach((raw, i) => {
      const cell = parseCell(raw);
      if (section !== 'Combo') { if (cell) lists.get(section).push(cell); return; }

      combo[i] ??= { title: '', grouped: false, groups: [[]] };
      const col = combo[i];
      if (cell) col.groups.at(-1).push(cell);
      else if (col.grouped && col.groups.at(-1).length) col.groups.push([]);
    });
  }

  const comboColumns = combo
    .filter(Boolean)
    .map((col) => ({ ...col, title: col.title || UNTITLED, groups: col.groups.filter((g) => g.length) }))
    .filter((col) => col.groups.length);

  return { lists, comboColumns };
}


/* ---- Scryfall ----------------------------------------------------------- */

/*
  Scryfall allows 2 requests a second on these endpoints and blocks clients
  that keep going after a 429, so a 429 stops the build instead of retrying.

  Exact names go out 75 at a time through /cards/collection. Whatever that
  misses (typos, "Crystal Skul") is retried one by one through the fuzzy
  /cards/named endpoint.
*/
const HEADERS = { 'User-Agent': 'richard-garfield-deck/1.0', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();   // "name|set" → card or null
const keyOf = ({ name, set }) => `${name.toLowerCase()}|${set ?? ''}`;

async function scryfall(url, init) {
  await sleep(550);
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init?.headers } });
  if (res.status === 429) throw new Error('Scryfall rate limit hit; wait a minute before running again.');
  return { ok: res.ok, json: await res.json() };
}

async function prefetch(cells) {
  const wanted = [...new Map(cells.map((c) => [keyOf(c), c])).values()];
  for (let i = 0; i < wanted.length; i += 75) {
    const batch = wanted.slice(i, i + 75);
    const { json } = await scryfall('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map(({ name, set }) => (set ? { name, set } : { name })) }),
    });
    for (const found of json.data ?? []) {
      const cell = batch.find((c) => found.name.toLowerCase() === c.name.toLowerCase()
        || found.card_faces?.some((f) => f.name.toLowerCase() === c.name.toLowerCase()));
      if (cell) cache.set(keyOf(cell), toCard(found));
    }
  }
}

async function lookup(cell) {
  const key = keyOf(cell);
  if (cache.has(key)) return cache.get(key);

  const url = new URL('https://api.scryfall.com/cards/named');
  url.searchParams.set('fuzzy', cell.name);
  if (cell.set) url.searchParams.set('set', cell.set);
  const { ok, json } = await scryfall(url);
  const card = ok ? toCard(json) : null;
  if (!card) console.warn(`  not found: ${cell.name} — ${json.details ?? 'no image'}`);
  else console.log(`  ${cell.name} → ${card.name}`);
  cache.set(key, card);
  return card;
}

function toCard(json) {
  const faces = json.image_uris ? [json] : (json.card_faces ?? []).filter((f) => f.image_uris);
  if (!faces.length) return null;
  return {
    name: json.name,
    mv: json.cmc,
    image: faces[0].image_uris.normal,
    large: faces.map((f) => f.image_uris.large),
    url: json.scryfall_uri.replace(/\?.*$/, ''),
  };
}

async function resolve(cell) {
  const card = await lookup(cell);
  return card ?? { name: cell.name, mv: costToMv(cell.cost), text: true };
}


/* ---- Build -------------------------------------------------------------- */

async function build() {
  const { lists, comboColumns } = readSheet(parseCsv(readFileSync(CSV, 'utf8')));
  const sections = [];
  await prefetch([...[...lists.values()].flat(), ...comboColumns.flatMap((c) => c.groups.flat())]);

  for (const { name, short } of SECTIONS) {
    const id = name.toLowerCase();

    if (name === 'Combo') {
      const subsections = [];
      for (const col of comboColumns) {
        const rows = [];
        for (const group of col.grouped ? col.groups : [col.groups.flat()]) {
          const cards = [];
          for (const cell of group) cards.push(await resolve(cell));
          rows.push(dedupe(cards));
        }
        subsections.push({ label: col.title, rows });
      }
      sections.push({ id, name, short, subsections });
      continue;
    }

    const cards = [];
    for (const cell of lists.get(name)) cards.push(await resolve(cell));
    const byMv = new Map();
    for (const card of dedupe(cards)) {
      if (!byMv.has(card.mv)) byMv.set(card.mv, []);
      byMv.get(card.mv).push(card);
    }
    const subsections = [...byMv.keys()]
      .sort((a, b) => a - b)
      .map((mv) => ({ label: String(mv), mv: true, rows: [byMv.get(mv)] }));
    sections.push({ id, name, short, subsections });
  }

  writeFileSync(OUT, JSON.stringify({ sections }, null, 1) + '\n');
  console.log(`wrote ${OUT}`);
}

/* The sheet lists a few cards twice in one section (once with a typo). */
function dedupe(cards) {
  const seen = new Set();
  return cards.filter((c) => !seen.has(c.name) && seen.add(c.name));
}

build();
