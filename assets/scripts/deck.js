/*
  deck.js — draws the page from assets/data/cards.json.

  The JSON holds each role's cards in sheet order, plus the combo groups. The
  page shows them one of two ways, switched by the button at the top of the
  jump strip:

    by role   Ramp, Draw, …     then mana value     then exact cost
    by MV     Mana Value 0, 1…  then role           then exact cost

  Either way each exact cost starts a new line — {1} and {U} are both mana
  value 1 but never share a row — and Combo comes last, grouped as in the sheet.

  To change which cards appear, edit the spreadsheet and rerun
  tools/build-cards.mjs; nothing here needs to change.
*/

const deck = document.getElementById('deck');
const index = document.getElementById('index');
const links = document.getElementById('index-links');
const toggle = document.getElementById('sort-toggle');
const bubble = document.getElementById('index-bubble');
const zoom = document.getElementById('zoom');

const { roles, combo } = await fetch('/assets/data/cards.json').then((r) => r.json());

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};


/* ---- Sorting ------------------------------------------------------------ */

const VIEWS = {
  role: { label: 'MV',   hint: 'Sort by mana value first' },
  mv:   { label: 'Role', hint: 'Sort by role first' },
};

const pip = (mv) => el('span', { className: 'pip' }, String(mv));
const colored = (cost) => (cost.match(/[WUBRG]/g) ?? []).length;

/* One row per exact cost, generic-heavy costs first: {2}, then {1}{U}, then {U}{U}. */
function rowsByCost(cards) {
  const rows = new Map();
  for (const c of cards) {
    if (!rows.has(c.cost)) rows.set(c.cost, []);
    rows.get(c.cost).push(c);
  }
  return [...rows.entries()].sort(([a], [b]) => colored(a) - colored(b)).map(([, row]) => row);
}

const manaValues = (cards) => [...new Set(cards.map((c) => c.mv))].sort((a, b) => a - b);

function sectionsFor(view) {
  const sections = view === 'role'
    ? roles.map((role) => ({
        ...role,
        title: role.name,
        subsections: manaValues(role.cards).map((mv) => ({
          title: pip(mv),
          rows: rowsByCost(role.cards.filter((c) => c.mv === mv)),
        })),
      }))
    : manaValues(roles.flatMap((r) => r.cards)).map((mv) => ({
        id: `mv-${mv}`,
        name: `Mana Value ${mv}`,
        short: String(mv),
        title: el('span', { className: 'section-title-mv' }, pip(mv), 'Mana Value'),
        subsections: roles
          .filter((role) => role.cards.some((c) => c.mv === mv))
          .map((role) => ({ title: role.name, rows: rowsByCost(role.cards.filter((c) => c.mv === mv)) })),
      }));

  return [...sections, { ...combo, title: combo.name, subsections: combo.subsections.map((s) => ({ ...s, title: s.label })) }];
}


/* ---- Cards -------------------------------------------------------------- */

let warmed = false;

function card(c) {
  if (c.text) return el('div', { className: 'card card-text', title: c.name }, el('span', {}, c.name));

  const button = el('button', { className: 'card', type: 'button', title: c.name },
    el('img', { src: c.faces[0], alt: c.name, width: 672, height: 936, loading: warmed ? 'eager' : 'lazy', decoding: 'async' }));
  button.addEventListener('click', () => openZoom(c));
  return button;
}

let view = 'role';
let sections = [];
try { if (localStorage.getItem('view') === 'mv') view = 'mv'; } catch {}

function render() {
  sections = sectionsFor(view);
  deck.replaceChildren(...sections.map((section) =>
    el('section', { id: section.id, className: 'section' },
      el('h2', { className: 'section-title' }, section.title),
      ...section.subsections.map((sub) => el('div', { className: 'subsection' },
        el('h3', { className: 'sub-title' }, sub.title),
        ...sub.rows.map((row) => el('div', { className: 'cards' }, ...row.map(card))))))));

  links.replaceChildren(...sections.map((section) =>
    el('a', { href: `#${section.id}`, title: section.name }, section.short)));

  toggle.textContent = VIEWS[view].label;
  toggle.title = toggle.ariaLabel = VIEWS[view].hint;
  spy();
}

/* Switching keeps the card at the top of the screen in view, wherever it lands. */
toggle.addEventListener('click', () => {
  const line = deck.querySelector('.section-title').offsetHeight;
  const anchor = [...deck.querySelectorAll('.card')].find((c) => c.getBoundingClientRect().bottom > line)?.title;

  view = view === 'role' ? 'mv' : 'role';
  try { localStorage.setItem('view', view); } catch {}
  render();

  const target = anchor && [...deck.querySelectorAll('.card')].find((c) => c.title === anchor);
  if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
});


/* ---- Zoom --------------------------------------------------------------- */

function openZoom(c) {
  zoom.replaceChildren(
    el('div', { className: 'zoom-faces' }, ...c.faces.map((src) => el('img', { src, alt: c.name }))),
    el('a', { className: 'zoom-link', href: c.url, target: '_blank', rel: 'noopener' }, 'Scryfall ↗'));
  zoom.showModal();
}

zoom.addEventListener('click', (e) => { if (!e.target.closest('a')) zoom.close(); });


/* ---- Jump strip ----------------------------------------------------------

  Touch the strip and slide a finger along it: the page jumps to whichever
  section is under the finger, and a bubble names it. Same as the letters on
  the side of iOS Contacts. The links are drawn by render().
*/

/*
  The bubble hides when the finger lifts, and also on its own 600 ms after the
  last jump: mobile Safari does not always report the finger lifting, and a
  bubble that never leaves covers the cards.
*/
let hideTimer;

function hideBubble() {
  clearTimeout(hideTimer);
  bubble.hidden = true;
  for (const a of links.children) a.classList.remove('active');
}

/* The link under the finger; above or below the strip counts as the first or last. */
function jumpTo(y) {
  const all = [...links.children];
  let i = all.findIndex((a) => y < a.getBoundingClientRect().bottom);
  if (i === -1) i = all.length - 1;
  const section = sections[i];
  all.forEach((a, j) => a.classList.toggle('active', j === i));
  bubble.textContent = section.name;
  bubble.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBubble, 600);
  document.getElementById(section.id).scrollIntoView({ block: 'start', behavior: 'instant' });
}

links.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  links.setPointerCapture(e.pointerId);
  jumpTo(e.clientY);
});
links.addEventListener('pointermove', (e) => { if (links.hasPointerCapture(e.pointerId)) jumpTo(e.clientY); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) links.addEventListener(type, hideBubble);
links.addEventListener('click', (e) => e.preventDefault());


/* ---- Scroll spy -----------------------------------------------------------

  Highlights the jump strip entry for the section on screen: the last section
  whose top has scrolled up past the line just under the sticky header.
*/

let spyQueued = false;

function spy() {
  spyQueued = false;
  const line = deck.querySelector('.section-title').offsetHeight + 1;
  let current = 0;
  sections.forEach((s, i) => { if (document.getElementById(s.id).getBoundingClientRect().top <= line) current = i; });
  [...links.children].forEach((a, i) => a.classList.toggle('current', i === current));
}

addEventListener('scroll', () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });
addEventListener('resize', spy);
render();


/* ---- Warm-up -------------------------------------------------------------

  Images below the fold load lazily, so the first screen appears fast. Once
  the page has settled, the rest load in the background, so a jump to any
  section finds its cards already there. _headers lets the phone keep them.
*/

/* Not the window's load event: this module awaits the JSON first, so that event may already be over. */
setTimeout(() => {
  warmed = true;
  for (const img of deck.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
}, 1500);
