/*
  deck.js — draws the page from assets/data/cards.json.

  The JSON is shaped like the page:

    sections[]        Ramp, Draw, … Combo — a big header each
      subsections[]   a mana value, or a combo column title — a small header each
        rows[]        cards that share a line; a new row always starts a new line,
                      which is how one combo is kept apart from the next

  To change which cards appear, edit the spreadsheet and rerun
  tools/build-cards.mjs; nothing here needs to change.
*/

const deck = document.getElementById('deck');
const index = document.getElementById('index');
const bubble = document.getElementById('index-bubble');
const zoom = document.getElementById('zoom');

const { sections } = await fetch('/assets/data/cards.json').then((r) => r.json());

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};


/* ---- Cards -------------------------------------------------------------- */

function card(c) {
  if (c.text) return el('div', { className: 'card card-text' }, el('span', {}, c.name));

  const button = el('button', { className: 'card', type: 'button', title: c.name },
    el('img', { src: c.faces[0], alt: c.name, width: 672, height: 936, loading: 'lazy', decoding: 'async' }));
  button.addEventListener('click', () => openZoom(c));
  return button;
}

for (const section of sections) {
  const node = el('section', { id: section.id, className: 'section' },
    el('h2', { className: 'section-title' }, section.name));

  for (const sub of section.subsections) {
    const title = sub.mv
      ? el('h3', { className: 'sub-title' }, el('span', { className: 'pip' }, sub.label))
      : el('h3', { className: 'sub-title' }, sub.label);
    node.append(el('div', { className: 'subsection' }, title,
      ...sub.rows.map((row) => el('div', { className: 'cards' }, ...row.map(card)))));
  }
  deck.append(node);
}


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
  the side of iOS Contacts.
*/

for (const section of sections) {
  index.append(el('a', { href: `#${section.id}`, title: section.name }, section.short));
}

/*
  The bubble hides when the finger lifts, and also on its own 600 ms after the
  last jump: mobile Safari does not always report the finger lifting, and a
  bubble that never leaves covers the cards.
*/
let hideTimer;

function hideBubble() {
  clearTimeout(hideTimer);
  bubble.hidden = true;
  for (const a of index.children) a.classList.remove('active');
}

function jumpTo(y) {
  const links = [...index.children];
  const rect = index.getBoundingClientRect();
  const i = Math.max(0, Math.min(links.length - 1, Math.floor(((y - rect.top) / rect.height) * links.length)));
  const section = sections[i];
  links.forEach((a, j) => a.classList.toggle('active', j === i));
  bubble.textContent = section.name;
  bubble.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBubble, 600);
  document.getElementById(section.id).scrollIntoView({ block: 'start', behavior: 'instant' });
}

index.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  index.setPointerCapture(e.pointerId);
  jumpTo(e.clientY);
});
index.addEventListener('pointermove', (e) => { if (index.hasPointerCapture(e.pointerId)) jumpTo(e.clientY); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) index.addEventListener(type, hideBubble);
index.addEventListener('click', (e) => e.preventDefault());


/* ---- Scroll spy -----------------------------------------------------------

  Highlights the jump strip entry for the section on screen: the last section
  whose top has scrolled up past the line just under the sticky header.
*/

const sectionNodes = sections.map((s) => document.getElementById(s.id));
let spyQueued = false;

function spy() {
  spyQueued = false;
  const line = deck.querySelector('.section-title').offsetHeight + 1;
  let current = 0;
  sectionNodes.forEach((node, i) => { if (node.getBoundingClientRect().top <= line) current = i; });
  [...index.children].forEach((a, i) => a.classList.toggle('current', i === current));
}

addEventListener('scroll', () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });
addEventListener('resize', spy);
spy();


/* ---- Warm-up -------------------------------------------------------------

  Images below the fold load lazily, so the first screen appears fast. Once
  the page has settled, the rest load in the background, so a jump to any
  section finds its cards already there. _headers lets the phone keep them.
*/

/* Not the window's load event: this module awaits the JSON first, so that event may already be over. */
setTimeout(() => {
  for (const img of deck.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
}, 1500);
