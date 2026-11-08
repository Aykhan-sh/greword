// Screens. Each renders to an HTML string; clicks are routed through data-a attributes
// to the `actions` table at the bottom. Every piece of content goes through esc().

import * as S from './state.js';
import { strategy, Revise, Mastery, NUMERALS, correctSet, isComplete, TYPE_SE, labelFor } from './core.js';

// ---- helpers ------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = esc;
const pct = (x) => `${Math.round(x * 100)}%`;
const ms = (t) => (t < 1000 ? `${t}ms` : `${(t / 1000).toFixed(1)}s`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fullDate = (t) => `${shortDate(t)} ${new Date(t).getFullYear()}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clock = (t) => `${Math.floor(t / 60000)}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}`;

function relativeDue(due, now) {
  const diff = due - now, days = diff / 86_400_000;
  if (diff <= 0) return 'due now';
  if (days < 1) return 'today';
  if (days < 2) return 'tomorrow';
  if (days < 14) return `in ${Math.round(days)}d`;
  return shortDate(due);
}

const MasteryOrder = [Mastery.SOLID, Mastery.GOOD, Mastery.SHAKY, Mastery.WEAK, Mastery.UNSEEN];
const LABEL = { UNSEEN: 'Unseen', WEAK: 'Weak', SHAKY: 'Shaky', GOOD: 'Good', SOLID: 'Solid' };
const COLOR = { UNSEEN: '#8A939C', WEAK: '#D1453B', SHAKY: '#E08A1E', GOOD: '#4C93D6', SOLID: '#2E9E63' };
const BLURB = {
  UNSEEN: 'never shown yet', WEAK: 'missed last time, or holds for under a day', SHAKY: 'holds for one to four days',
  GOOD: 'holds for four to ten days', SOLID: 'holds for ten days or more',
};
const PIP = { '-3': '#2E6FA8', '-2': '#4C93D6', '-1': '#9CC2E4', 0: '#B0B8C0', 1: '#E8B07A', 2: '#D98032', 3: '#B85C1A' };

const dot = (m) => `<span class="dot" style="--c:${COLOR[m]}">${LABEL[m]}</span>`;
const greyDot = (label) => `<span class="dot" style="--c:var(--muted)">${esc(label)}</span>`;

function bar(parts, total, h = 10) {
  const denom = Math.max(1, total);
  return `<div class="bar" style="height:${h}px">${parts.filter(([, n]) => n > 0)
    .map(([c, n]) => `<i style="flex:${n / denom};background:${c}"></i>`).join('')}<i style="flex:${Math.max(0, 1 - parts.reduce((s, [, n]) => s + n, 0) / denom)}"></i></div>`;
}
const masteryBar = (buckets, total, h) => bar(MasteryOrder.map((m) => [COLOR[m], buckets.get(m) ?? 0]), total, h);
const reviseBar = (right, left, total) => bar([['var(--right)', right], ['var(--wrong)', left]], total);

function buckets(keys) {
  const m = new Map();
  for (const k of keys) { const b = S.app.mastery(k); m.set(b, (m.get(b) ?? 0) + 1); }
  return m;
}

const icon = {
  back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M21 5c-1.1-.4-2.3-.5-3.5-.5-1.9 0-4 .4-5.5 1.5-1.4-1.1-3.5-1.5-5.5-1.5S2.5 4.9 1 6v14.6c0 .3.3.5.5.5h.3c1.4-.7 3.3-1.1 4.7-1.1 1.9 0 4 .4 5.5 1.5 1.3-.8 3.8-1.5 5.5-1.5 1.6 0 3.3.3 4.7 1.1h.3c.3 0 .5-.3.5-.5V6c-.6-.5-1.3-.8-2-1zm0 13.5c-1.1-.3-2.3-.5-3.5-.5-1.7 0-4.2.7-5.5 1.5V8c1.3-.8 3.8-1.5 5.5-1.5 1.2 0 2.4.2 3.5.5v11.5z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M3 17.2V21h3.8L17.8 9.9l-3.7-3.7L3 17.2zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7L20.7 7z"/></svg>',
  study: '<svg viewBox="0 0 24 24"><path d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zM5 13.2v4L12 21l7-3.8v-4L12 17l-7-3.8z"/></svg>',
  decks: '<svg viewBox="0 0 24 24"><path d="M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/></svg>',
  stats: '<svg viewBox="0 0 24 24"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M19.1 12.9a7 7 0 0 0 0-1.8l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.5-.9L14.8 3h-4l-.4 2.6c-.5.2-1 .5-1.5.9l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 1.8l-2 1.6 2 3.4 2.4-1c.5.4 1 .7 1.5.9l.4 2.6h4l.4-2.6c.5-.2 1-.5 1.5-.9l2.4 1 2-3.4-2-1.6zM12.8 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>',
};

// ---- UI-only state ------------------------------------------------------------

export const ui = {
  route: { name: 'home' },
  stats: { tab: 0, query: '', filter: null, sort: 'WEAKEST', open: new Set() },
  deckQuery: '',
  revise: { openId: undefined, showRight: false },
  card: { showOrigin: false, showSynonyms: false, key: null },
  modal: null,
};

const TABS = [['home', 'Study', icon.study], ['decks', 'Decks', icon.decks], ['stats', 'Stats', icon.stats], ['settings', 'Settings', icon.settings]];

function nav() {
  return `<nav class="tabs">${TABS.map(([r, label, ic]) =>
    `<button data-a="go" data-r="${r}" class="${ui.route.name === r ? 'on' : ''}">${ic}<span>${label}</span></button>`).join('')}</nav>`;
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---- Study tab (home) -------------------------------------------------------------

function homeScreen() {
  const a = S.app, cfg = a.cfg, now = a.computedAt;
  const daysLeft = strategy.daysUntilExam(cfg, now);
  const plan = S.currentPlan();
  const selected = a.eligible.length;
  const keys = a.eligible.map((w) => w.wordKey);
  const bk = buckets(keys);
  const reviewed = keys.filter((k) => (a.progress.get(k)?.reps ?? 0) > 0).length;

  const install = !isStandalone() ? `<section class="card install">
      <h3>Install on your phone</h3>
      <p class="small">${isIOS()
        ? 'In Safari, tap the Share button, then <b>Add to Home Screen</b>. GREWord then opens full-screen and works offline. Your progress is kept by the installed app, so study from the home-screen icon rather than this tab.'
        : 'Use your browser menu to install or add this page to your home screen. It then opens full-screen and works offline.'}</p>
    </section>` : '';

  const rushed = (plan.minutesSinceLast ?? Infinity) < cfg.recoveryMinutes;
  const mixText = (rushed ? 'Hard on the heels of the last one, so this leans towards words you already hold. ' : '') +
    MasteryOrder.map((m) => (plan.mix.get(m) ?? 0) > 0 ? `${plan.mix.get(m)} ${LABEL[m].toLowerCase()}` : null).filter(Boolean).join(', ');

  const tally = a.questionTally;
  const planned = tally.results.slice(0, tally.planned);
  const right = planned.filter(Boolean).length;

  const unseen = plan.unseenCount;
  const short = unseen > 0 && cfg.newPerDay < plan.requiredNewPerDay;

  return `<main class="page">
    <h1>GREWord</h1>
    <p class="muted">${plural(daysLeft, 'day')} until your exam · ${fullDate(cfg.examEpochMs)}</p>
    ${install}
    <section class="card primary">
      <h3>${plan.sessionNumber > cfg.sessionsPerDay
        ? `Sitting ${plan.sessionNumber} today, past your planned ${cfg.sessionsPerDay}`
        : `Sitting ${plan.sessionNumber} of ${cfg.sessionsPerDay} today`}</h3>
      ${plan.minutesSinceLast != null ? `<p class="small muted">last one ${plan.minutesSinceLast < 60 ? `${plan.minutesSinceLast} min` : `${Math.floor(plan.minutesSinceLast / 60)}h ${plan.minutesSinceLast % 60}m`} ago</p>` : ''}
      <div class="metrics">
        ${[[plan.dueCount, 'due'], [plan.newCount, 'new'], [plan.aheadCount, 'extra'], [plan.queue.length, 'cards']]
          .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}
      </div>
      ${plan.queue.length ? `${masteryBar(plan.mix, plan.queue.length)}<p class="small muted">${esc(mixText)}</p>` : ''}
      <button class="btn" data-a="startSession" ${plan.queue.length ? '' : 'disabled'}>${
        selected === 0 ? 'No decks selected' : plan.queue.length ? 'Start session' : 'Nothing due right now'}</button>
      ${plan.queue.length ? '' : `<p class="small">${selected === 0 ? 'Pick some decks on the Decks tab first.' : 'Everything selected is scheduled for a later day.'}</p>`}
    </section>

    ${reviseCard()}

    <section class="card">
      <h3>GRE question</h3>
      <p class="small muted">One Text Completion or Sentence Equivalence item, timed, with the explanation afterwards.</p>
      ${tally.planned > 0 ? `
        <div class="tally">${Array.from({ length: tally.planned }, (_, i) =>
          `<i class="${planned[i] == null ? '' : planned[i] ? 'r' : 'w'}"></i>`).join('')}</div>
        <p class="small muted">${tally.results.length === 0 ? `${tally.planned} planned today`
          : !tally.planComplete ? `${tally.done} of ${tally.planned} today · ${right} right, ${tally.done - right} wrong`
            : `Today's ${tally.planned} done · ${right} right, ${tally.planned - right} wrong`}</p>
        ${tally.extra > 0 ? `<p class="small accent">Beyond the plan: +${tally.extra} · ${tally.extraRight} right, ${tally.extraWrong} wrong</p>` : ''}` : ''}
      <button class="btn outline" data-a="openQuestion">Take a question</button>
    </section>

    <section class="card">
      <h3>Where you stand</h3>
      <p class="small muted">${reviewed} of ${selected} selected words have been tested at least once.</p>
      ${masteryBar(bk, selected, 12)}
      <div class="legend-list">${MasteryOrder.filter((m) => (bk.get(m) ?? 0) > 0).map((m) =>
        `<div><i style="background:${COLOR[m]}"></i><span>${LABEL[m]}</span><b>${bk.get(m)}</b></div>`).join('')}</div>
    </section>

    <section class="card">
      <h3>Pace</h3>
      <p>${unseen === 0 ? 'Every selected word has been introduced. Sittings are pure review from here.'
        : short ? `${unseen} words are still unseen. Meeting them all before the exam would need about ${plan.requiredNewPerDay} new a day; your allowance is ${cfg.newPerDay}, which reaches roughly ${cfg.newPerDay * daysLeft} of them in time. ${a.day.newWordsToday} met so far today.`
          : `${unseen} words are still unseen. Your allowance of ${cfg.newPerDay} a day covers them with room to spare. ${a.day.newWordsToday} met so far today.`}</p>
      ${short ? '<p class="small error">Raise the daily allowance in Settings, or narrow the deck selection so the words you do meet get the repetitions they need.</p>' : ''}
      <p class="label accent">${esc(strategy.displayName)}</p>
      <p class="small muted">${esc(strategy.summary)}</p>
    </section>
  </main>`;
}

function reviseCard() {
  const a = S.app;
  const selected = a.eligible.map((w) => w.wordKey);
  const selectedSet = new Set(selected);
  const open = Revise.open(a.reviseRounds, selected);
  const last = a.reviseRounds.at(-1);
  const shown = open ?? last;
  const results = shown ? [...shown.results].filter(([k]) => selectedSet.has(k)) : [];
  const right = results.filter(([, v]) => v).length, left = results.length - right;
  return `<section class="card">
    <h3>Revise everything</h3>
    <p class="small muted">${open ? `Round ${open.number}: ${results.length} of ${selected.length} checked`
      : last ? `Round ${last.number} finished. Start again to re-check every word.`
        : 'Every selected word once, oldest first. Stop whenever you like and pick up where you left off.'}</p>
    ${shown ? `${reviseBar(right, left, open ? selected.length : results.length)}<p class="small muted">${right} right · ${left} left</p>` : ''}
    <button class="btn outline" data-a="startRevise" ${selected.length ? '' : 'disabled'}>${
      open ? 'Continue revising' : last ? `Start round ${last.number + 1}` : 'Start revising'}</button>
  </section>`;
}

// ---- study session --------------------------------------------------------------

function studyScreen() {
  const s = S.session;
  const card = S.currentCard();
  if (s.finished || !card) return summaryScreen();
  if (ui.card.key !== `${s.sessionId}:${s.index}`) {
    ui.card = { showOrigin: false, showSynonyms: false, key: `${s.sessionId}:${s.index}`, faded: false };
  }
  // Fade the back in once, on reveal, not again on every re-render of the same card.
  const fade = s.revealed && !ui.card.faded;
  if (s.revealed) ui.card.faded = true;
  const r = s.revise;
  const checked = r ? r.checkedBefore + s.answered : 0;
  const rRight = r ? r.rightBefore + s.correct : 0;
  const progress = r ? checked / Math.max(1, r.roundSize) : s.queue.length ? s.index / s.queue.length : 0;
  const origin = S.etymology.words[card.wordKey];
  const speak = 'speechSynthesis' in window;

  return `<div class="study">
    <div class="topbar">
      <button class="icon" data-a="undo" ${s.canUndo ? '' : 'disabled'} aria-label="Previous card">${icon.back}</button>
      <span class="label muted">${r ? `${checked} / ${r.roundSize}` : `${s.index + 1} / ${s.queue.length}`}</span>
      ${origin ? `<button class="icon ${ui.card.showOrigin && s.revealed ? 'accent' : ''}" data-a="toggleOrigin" ${s.revealed ? '' : 'disabled'} aria-label="Where ${attr(card.word)} comes from">${icon.book}</button>` : ''}
      <span class="grow"></span>
      ${r ? `<span class="label right">✓ ${rRight}</span><span class="label wrong">✗ ${checked - rRight}</span>`
        : s.answered > 0 ? `<span class="label muted">${Math.round(s.correct * 100 / s.answered)}%</span>` : ''}
      <button class="icon" data-a="exitStudy" aria-label="End session">${icon.close}</button>
    </div>
    <div class="progress"><i style="width:${(progress * 100).toFixed(1)}%"></i></div>
    <div class="cardzone" id="cardzone">
      <div class="verdict no" id="vNo">DIDN'T KNOW</div>
      <div class="verdict yes" id="vYes">KNEW IT</div>
      <div class="cardinner" id="cardinner">
        ${card.attempt > 0 ? '<p class="tag muted">second look</p>' : card.isNew ? '<p class="tag accent">new</p>' : ''}
        <h2 class="word">${esc(card.word)}</h2>
        ${s.revealed ? `<div class="back ${fade ? 'fadein' : ''}">
          ${speak ? `<button class="icon accent" data-a="speak" aria-label="Hear ${attr(card.word)}">${icon.speaker}</button>` : ''}
          <hr>
          <p class="definition">${esc(card.definition)}</p>
          ${card.example ? `<p class="example">“${esc(card.example)}”</p>` : ''}
          ${ui.card.showOrigin && origin ? `<div class="origin"><p class="label accent">Origin</p><p class="small">${esc(origin)}</p>${S.etymology.credit ? `<p class="tiny muted">${esc(S.etymology.credit)}</p>` : ''}</div>` : ''}
          ${card.synonyms.length || card.opposite ? `<button class="text small" data-a="toggleSynonyms">${ui.card.showSynonyms ? 'Hide synonyms' : 'Synonyms'}</button>
            ${ui.card.showSynonyms ? `<div class="neighbours">
              ${card.synonyms.length ? `<p class="tiny muted">${card.sense ? `close in meaning · ${esc(card.sense)}` : 'close in meaning'}</p><p class="syn">${card.synonyms.map(esc).join('  ·  ')}</p>` : ''}
              ${card.opposite ? `<p class="tiny muted">opposite</p><p class="opp">${esc(card.opposite)}</p>` : ''}
            </div>` : ''}` : ''}
          <div class="meta">${dot(card.mastery)}<span class="tiny muted">${esc(card.deck)}</span></div>
        </div>` : '<p class="hint muted">tap anywhere to reveal</p>'}
      </div>
    </div>
    <div class="studyfoot">
      <div class="legend" id="legend">${s.revealed ? '<span id="lNo">← Didn\'t know</span><span id="lYes">Knew it →</span>' : ''}</div>
      <button class="text small muted" data-a="confirmExclude">I'm confident — stop showing this</button>
    </div>
  </div>`;
}

function summaryScreen() {
  const s = S.session;
  const minutes = Math.round((Date.now() - (s.startedAtMs ?? Date.now())) / 60000);
  const stat = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  if (s.revise) {
    const r = s.revise, checked = r.checkedBefore + s.answered, right = r.rightBefore + s.correct;
    const complete = checked >= r.roundSize;
    return `<main class="page center"><section class="card summary">
      <h2>${complete ? `Round ${r.roundNumber} complete` : `Round ${r.roundNumber} paused`}</h2>
      <p class="muted">${checked} of ${r.roundSize} words checked</p>
      <div class="metrics">${stat(right, 'right')}${stat(checked - right, 'left')}${stat(s.answered, 'this sitting')}${stat(`${minutes}m`, 'spent')}</div>
      <p class="small muted">${complete ? 'Every word has been checked once. The words you swiped left now come back in your normal sessions.'
        : 'Your place is kept. Revise again any time to carry on from here.'}</p>
      <button class="btn" data-a="doneStudy">Done</button>
    </section></main>`;
  }
  return `<main class="page center"><section class="card summary">
    <h2>Session complete</h2>
    <div class="metrics">${stat(s.answered, 'answers')}${stat(s.answered ? `${Math.round(s.correct * 100 / s.answered)}%` : '—', 'correct')}${stat(s.startedAtMs ? `${minutes}m` : '—', 'spent')}</div>
    <p class="small muted">Every answer was written to the log, so this counts even if the strategy changes later.</p>
    <button class="btn" data-a="doneStudy">Done</button>
  </section></main>`;
}

const COMMIT_FRACTION = 0.26;
const COMMIT_VELOCITY = 0.9; // px per ms

/** Tap anywhere in the card area to reveal; once revealed, swipe right if you knew it. */
function attachCardGestures() {
  const zone = document.getElementById('cardzone');
  const inner = document.getElementById('cardinner');
  if (!zone || !inner) return;
  let start = null, dragging = false, samples = [];
  const width = () => Math.max(1, zone.clientWidth);
  const paint = (dx) => {
    inner.style.transform = `translateX(${dx}px) rotate(${(dx / width()) * 7}deg)`;
    const pull = Math.min(1, Math.abs(dx) / (width() * COMMIT_FRACTION));
    const badge = (id, on) => { const el = document.getElementById(id); if (el) el.style.opacity = on ? pull : 0; };
    const legend = (id, on) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.opacity = 0.55 + 0.45 * (on ? pull : 0);
      el.classList.toggle('lit', on && pull > 0);
      el.classList.toggle('strong', on && pull > 0.5);
    };
    badge('vNo', dx < 0); badge('vYes', dx > 0); legend('lNo', dx < 0); legend('lYes', dx > 0);
  };
  zone.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    start = { x: e.clientX, y: e.clientY };
    dragging = false;
    samples = [{ x: e.clientX, t: e.timeStamp }];
  });
  zone.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) dragging = true;
    if (dragging && S.session.revealed) {
      inner.style.transition = 'none';
      paint(dx);
      samples.push({ x: e.clientX, t: e.timeStamp });
      if (samples.length > 5) samples.shift();
    }
  });
  const end = (e, cancelled) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    const moved = Math.hypot(dx, dy) > 10;
    start = null;
    // A drag on an unrevealed card is swallowed rather than treated as a tap, so a quick
    // flick never reveals the meaning by accident.
    // The reveal itself waits for the click event: re-rendering on pointerup lets iOS deliver
    // the trailing click to whatever button the new card draws under the finger.
    if (!dragging) { tapToReveal = !moved && !cancelled; return; }
    dragging = false;
    if (!S.session.revealed) return;
    const first = samples[0], last = samples[samples.length - 1];
    const v = last && first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    if (Math.abs(dx) > width() * COMMIT_FRACTION || (Math.abs(v) > COMMIT_VELOCITY && Math.sign(v) === Math.sign(dx))) commit(dx > 0);
    else { inner.style.transition = 'transform .25s cubic-bezier(.2,1.4,.4,1)'; paint(0); }
  };
  let tapToReveal = false;
  zone.addEventListener('click', (e) => {
    if (tapToReveal && !e.target.closest('button') && !S.session.revealed) S.reveal();
    tapToReveal = false;
  });
  zone.addEventListener('pointerup', (e) => end(e, false));
  zone.addEventListener('pointercancel', (e) => end(e, true));
}

let committing = false;
function commit(knewIt) {
  if (committing || !S.session.revealed) return;
  committing = true;
  const key = `${S.session.sessionId}:${S.session.index}`;
  const inner = document.getElementById('cardinner');
  const zone = document.getElementById('cardzone');
  if (inner && zone) {
    inner.style.transition = 'transform .18s ease-in';
    const w = zone.clientWidth * 1.4 * (knewIt ? 1 : -1);
    inner.style.transform = `translateX(${w}px) rotate(${knewIt ? 9 : -9}deg)`;
  }
  setTimeout(() => { committing = false; S.answer(knewIt, key); }, 180);
}

// ---- GRE question ---------------------------------------------------------------

const TYPE_LABEL = { tc1: 'Text Completion', tc2: 'Text Completion · two blanks', tc3: 'Text Completion · three blanks', se: 'Sentence Equivalence' };

function questionScreen() {
  const st = S.question;
  if (st.bankError) {
    return `<main class="page center"><section class="card summary">
      <h2>No questions available</h2><p class="small error">${esc(st.bankError)}</p>
      <button class="btn" data-a="leaveQuestion">Done</button></section></main>`;
  }
  if (st.loading || !st.q) return '<main class="page center"><div class="spinner"></div></main>';
  const q = st.q;
  const elapsed = st.submitted ? st.elapsedMs : Math.max(0, Date.now() - st.shownAtMs);

  let rest = q.stem, stem = '';
  const re = /___\((i{1,3})\)___/;
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    stem += esc(rest.slice(0, m.index));
    const blank = NUMERALS.indexOf(m[1]);
    const chosen = [...(st.selection[blank] ?? [])].sort((a, b) => a - b);
    const fill = chosen.length ? chosen.map((i) => q.blanks[blank].choices[i]).join(' / ') : `(${m[1]}) ________`;
    const cls = !st.submitted || !chosen.length ? 'accent'
      : (chosen.length === correctSet(q.blanks[blank]).size && chosen.every((c) => correctSet(q.blanks[blank]).has(c))) ? 'right' : 'wrong';
    stem += `<u class="fill ${cls}">${esc(fill)}</u>`;
    rest = rest.slice(m.index + m[0].length);
  }
  stem += esc(rest);

  const column = (bi) => {
    const b = q.blanks[bi], chosen = st.selection[bi], ok = correctSet(b);
    return `<div class="choices">${q.blanks.length > 1 ? `<p class="label muted">Blank (${NUMERALS[bi]})</p>` : ''}
      ${b.choices.map((text, i) => {
        const sel = chosen.has(i);
        const verdict = st.submitted ? ok.has(i) : null;
        const cls = verdict === true ? 'right' : verdict === false && sel ? 'wrong' : sel ? 'sel' : '';
        const mark = verdict === true ? '✓' : verdict === false && sel ? '✗' : '';
        return `<button class="choice ${cls} ${q.blanks.length > 1 ? 'compact' : ''}" data-a="choose" data-b="${bi}" data-c="${i}" ${st.submitted ? 'disabled' : ''}><span>${esc(text)}</span>${mark ? `<b>${mark}</b>` : ''}</button>`;
      }).join('')}</div>`;
  };

  return `<div class="qscreen">
    <div class="topbar">
      <button class="icon" data-a="leaveQuestion" aria-label="Leave the question">${icon.close}</button>
      <span class="label muted">${TYPE_LABEL[q.type] ?? ''}</span>
      <span class="grow"></span>
      <span class="clock" id="qclock">${clock(elapsed)}</span>
    </div>
    <main class="page">
      <section class="card stem">${stem}</section>
      ${q.type === TYPE_SE ? '<p class="small muted">Select the two choices that fit the blank and produce sentences alike in meaning.</p>' : ''}
      <div class="blanks n${q.blanks.length}">${q.blanks.map((_, i) => column(i)).join('')}</div>
      ${!st.submitted
        ? `<button class="btn" data-a="submitQuestion" ${isComplete(q, st.selection) ? '' : 'disabled'}>Submit</button>`
        : `<p class="verdictline ${st.correct ? 'right' : 'wrong'}">${st.correct ? 'Correct' : 'Incorrect'} · ${clock(st.elapsedMs)}</p>
          <section class="card"><p class="label">Explanation</p><p>${esc(q.explanation)}</p></section>
          <button class="btn" data-a="nextQuestion">Next question</button>`}
    </main>
  </div>`;
}

export { homeScreen, studyScreen, questionScreen, attachCardGestures, commit, esc, attr, pct, ms, shortDate, fullDate, plural, relativeDue, MasteryOrder, LABEL, COLOR, BLURB, PIP, dot, greyDot, masteryBar, reviseBar, buckets, icon, nav, labelFor, Mastery, isIOS, isStandalone };
