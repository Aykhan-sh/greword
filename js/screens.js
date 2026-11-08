// Decks, Stats and Settings.

import * as S from './state.js';
import { strategy } from './core.js';
import {
  ui, esc, attr, pct, ms, shortDate, fullDate, relativeDue, MasteryOrder, LABEL, COLOR, BLURB, PIP,
  dot, greyDot, masteryBar, reviseBar, buckets, icon, labelFor, Mastery, isIOS,
} from './ui.js';

// ---- Decks ------------------------------------------------------------------------

export function decksScreen() {
  const a = S.app;
  return `<main class="page">
    <h1>Decks</h1>
    <p class="muted">Tick the decks you want in rotation. ${a.eligible.length} words are currently selected.</p>
    <div class="row"><button class="text" data-a="allDecks" data-on="1">Select all</button><button class="text" data-a="allDecks" data-on="0">Select none</button></div>
    <ul class="list">${a.decks.map((deck) => {
      const words = a.words.filter((w) => w.deck === deck);
      const included = words.filter((w) => a.wordIncluded(w.wordKey)).length;
      return `<li class="rowitem">
        <label class="check"><input type="checkbox" data-a="deckToggle" data-deck="${attr(deck)}" ${a.deckEnabled(deck) ? 'checked' : ''}></label>
        <button class="rowmain" data-a="openDeck" data-deck="${attr(deck)}">
          <span><b>${esc(deck)}</b><small>${deck !== S.CUSTOM_DECK ? `${included} of ${words.length} words included`
            : words.length ? `${included} of ${words.length} of your own words included` : 'Tap to add your own words'}</small></span>
          ${icon.chevron}
        </button>
      </li>`;
    }).join('')}</ul>
  </main>`;
}

export function deckScreen(deck) {
  const custom = deck === S.CUSTOM_DECK;
  const words = S.app.words.filter((w) => w.deck === deck);
  return `<header class="appbar"><button class="icon" data-a="go" data-r="decks" aria-label="Back">${icon.back}</button><h2>${esc(deck)}</h2></header>
  <main class="page">
    <p class="small muted">${custom ? 'Your own words. Tap the pencil on one to edit or remove it.' : 'Untick anything already obvious to you so it never comes up.'}</p>
    ${custom ? '<button class="btn small-btn" data-a="addWord">+ Add word</button>' : ''}
    <input class="search" type="search" placeholder="Search this deck" data-input="deckQuery" value="${attr(ui.deckQuery)}">
    ${words.length ? '<div class="row"><button class="text" data-a="deckWordsAll" data-on="1">Include all</button><button class="text" data-a="deckWordsAll" data-on="0">Exclude all</button></div>' : ''}
    <ul class="list" id="list">${deckList(deck)}</ul>
  </main>`;
}

export function deckShown(deck) {
  const q = ui.deckQuery.trim().toLowerCase();
  return S.app.words.filter((w) => w.deck === deck && (!q || w.word.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q)));
}

export function deckList(deck) {
  const custom = deck === S.CUSTOM_DECK;
  const shown = deckShown(deck);
  if (custom && !shown.length) {
    return '<li class="empty muted">Nothing here yet. Add a word, its meaning, and an example sentence above to start building your own deck.</li>';
  }
  return shown.map((w) => `<li class="rowitem">
    <label class="check"><input type="checkbox" data-a="wordToggle" data-key="${attr(w.wordKey)}" ${S.app.wordIncluded(w.wordKey) ? 'checked' : ''}></label>
    <button class="rowmain" data-a="wordToggleRow" data-key="${attr(w.wordKey)}"><span><b>${esc(w.word)}</b><small class="clamp2">${esc(w.definition)}</small></span>${dot(S.app.mastery(w.wordKey))}</button>
    ${custom ? `<button class="icon" data-a="editWord" data-key="${attr(w.wordKey)}" aria-label="Edit ${attr(w.word)}">${icon.edit}</button>` : ''}
  </li>`).join('');
}

// ---- Stats ------------------------------------------------------------------------

const SORTS = {
  WEAKEST: 'Least confident', ACCURACY: 'Lowest accuracy', SLOWEST: 'Slowest to recall',
  MOST_SEEN: 'Most reviewed', DUE: 'Due soonest', ALPHA: 'A to Z',
};

export function statsScreen() {
  const tabs = ['Words', 'Meanings', 'Revise'];
  return `<main class="page">
    <h1>Statistics</h1>
    <div class="segmented">${tabs.map((t, i) => `<button data-a="statsTab" data-i="${i}" class="${ui.stats.tab === i ? 'on' : ''}">${t}</button>`).join('')}</div>
    ${ui.stats.tab === 0 ? wordStats() : ui.stats.tab === 1 ? clusterList() : reviseRounds()}
  </main>`;
}

function wordStats() {
  const a = S.app;
  const keys = a.eligible.map((w) => w.wordKey);
  const bk = buckets(keys);
  const reviewed = keys.map((k) => a.progress.get(k)).filter(Boolean);
  const totalReps = reviewed.reduce((s, p) => s + p.reps, 0);
  const totalCorrect = reviewed.reduce((s, p) => s + p.correctCount, 0);
  const lat = reviewed.map((p) => p.medianRevealMs).sort((x, y) => x - y);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  const st = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  return `<section class="card">
      <div class="metrics small-metrics">${st(totalReps, 'answers')}${st(totalReps ? pct(totalCorrect / totalReps) : '—', 'accuracy')}${st(median ? ms(median) : '—', 'median time')}${st(keys.length, 'in rotation')}</div>
      ${masteryBar(bk, keys.length, 12)}
      <div class="chips">${MasteryOrder.map((m) => `<button class="chip ${ui.stats.filter === m ? 'on' : ''}" data-a="statsFilter" data-m="${m}">${LABEL[m]} ${bk.get(m) ?? 0}</button>`).join('')}</div>
    </section>
    <div class="row searchrow">
      <input class="search" type="search" placeholder="Search" data-input="statsQuery" value="${attr(ui.stats.query)}">
      <select data-change="statsSort">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${ui.stats.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <ul class="list" id="list">${statsList()}</ul>
    <section class="howto">
      <p class="label">How to read this</p>
      ${[...MasteryOrder].reverse().map((m) => `<p class="small muted">${LABEL[m]}: ${BLURB[m]}</p>`).join('')}
      <p class="small muted">Confidence blends the whole record: how often you have been right, how it has gone lately, how quickly the meaning comes, how long the word holds, and the model's estimate that you would get it right this second. Sessions work through each class least confident first.</p>
    </section>`;
}

export function statsList() {
  const a = S.app, cfg = a.cfg, now = a.computedAt;
  const q = ui.stats.query.trim().toLowerCase();
  let rows = a.eligible.map((e) => {
    const w = a.byKey.get(e.wordKey);
    const p = a.progress.get(e.wordKey);
    return { key: e.wordKey, w, p, mastery: a.mastery(e.wordKey), confidence: strategy.confidence(p, cfg, now) };
  }).filter((r) => r.w && (!ui.stats.filter || r.mastery === ui.stats.filter) &&
    (!q || r.w.word.toLowerCase().includes(q) || r.w.definition.toLowerCase().includes(q)));
  const by = (f) => (x, y) => { const a1 = f(x), b1 = f(y); return a1 < b1 ? -1 : a1 > b1 ? 1 : 0; };
  switch (ui.stats.sort) {
    case 'WEAKEST': rows.sort((x, y) => (x.mastery === Mastery.UNSEEN) - (y.mastery === Mastery.UNSEEN) || x.confidence - y.confidence); break;
    case 'ACCURACY': rows.sort((x, y) => (x.p == null) - (y.p == null) || (x.p?.accuracy ?? 1) - (y.p?.accuracy ?? 1)); break;
    case 'SLOWEST': rows.sort((x, y) => (y.p?.medianRevealMs ?? -1) - (x.p?.medianRevealMs ?? -1)); break;
    case 'MOST_SEEN': rows.sort((x, y) => (y.p?.reps ?? 0) - (x.p?.reps ?? 0)); break;
    case 'DUE': rows.sort((x, y) => (x.p?.dueMs ?? Infinity) - (y.p?.dueMs ?? Infinity)); break;
    case 'ALPHA': rows.sort(by((r) => r.w.word.toLowerCase())); break;
  }
  if (!rows.length) return '<li class="empty muted">No words match.</li>';
  return rows.map((r) => `<li class="statrow" data-a="statOpen" data-key="${attr(r.key)}">
    <div class="line"><b>${esc(r.w.word)}</b>${dot(r.mastery)}</div>
    <small class="muted">${r.p == null ? `not yet tested · ${esc(r.w.deck)}`
      : `${r.p.correctCount}/${r.p.reps} correct · ${pct(r.p.accuracy)} · confidence ${pct(r.confidence)} · ${ms(r.p.medianRevealMs)} · ${relativeDue(r.p.dueMs, now)}`}</small>
    ${ui.stats.open.has(r.key) ? `<p class="def">${esc(r.w.definition)}</p>` : ''}
  </li>`).join('');
}

function inRotation(key) {
  const w = S.app.byKey.get(key);
  return !!w && S.app.deckEnabled(w.deck) && S.app.wordIncluded(key);
}

function clusterList() {
  const rows = S.clusters.axes.map((axis) => {
    const live = axis.words.map((m) => m.w).filter(inRotation);
    const bk = buckets(live);
    return { axis, live: live.length, total: axis.words.length, bk, weak: (bk.get(Mastery.WEAK) ?? 0) + (bk.get(Mastery.SHAKY) ?? 0) };
  }).sort((x, y) => (y.live > 0) - (x.live > 0) || y.weak - x.weak || (x.axis.title < y.axis.title ? -1 : 1));
  return `<p class="small muted">Words that crowd around one meaning, and the pairs that pull against each other. This is a map to consult, not a drill — sessions deliberately keep these neighbours apart.</p>
    <ul class="list">${rows.map((r) => `<li><button class="rowmain block" data-a="openCluster" data-id="${attr(r.axis.id)}">
      <span><b>${esc(r.axis.title)}</b><small>${esc(r.axis.left)}  ←→  ${esc(r.axis.right)}</small>
      ${masteryBar(r.bk, r.live, 8)}
      <small>${r.live === 0 ? `${r.total} words, none in rotation` : `${r.live} in rotation · ${r.weak} not yet solid`}</small></span>
      ${icon.chevron}</button></li>`).join('')}</ul>`;
}

const pips = (pos) => `<span class="pips">${[-3, -2, -1, 0, 1, 2, 3].map((p) =>
  `<i style="${p === pos ? `height:14px;background:${PIP[p]}` : ''}"></i>`).join('')}</span>`;

export function clusterScreen(id) {
  const axis = S.clusters.byId.get(id);
  if (!axis) return '<main class="page center">Not found</main>';
  const positions = [...new Set(axis.words.map((m) => m.p))].sort((a, b) => a - b);
  return `<header class="appbar"><button class="icon" data-a="backToStats" aria-label="Back">${icon.back}</button><h2>${esc(axis.title)}</h2></header>
  <main class="page">
    <div class="scale"><div class="poles"><span>${esc(axis.left)}</span><span>${esc(axis.right)}</span></div>
      <div class="scalebar">${[-3, -2, -1, 0, 1, 2, 3].map((p) => `<i style="background:${PIP[p]}"></i>`).join('')}</div></div>
    ${axis.note ? `<p class="small muted">${esc(axis.note)}</p>` : ''}
    ${positions.map((pos) => `<div class="poshead">${pips(pos)}<span class="label accent">${esc(labelFor(axis, pos))}</span></div>
      <ul class="list">${axis.words.filter((m) => m.p === pos).map((m) => {
        const w = S.app.byKey.get(m.w);
        const included = S.app.wordIncluded(m.w) && (!w || S.app.deckEnabled(w.deck));
        return `<li class="clword"><span><b class="${included ? '' : 'muted'}">${esc(w?.word ?? m.w)}</b><small class="muted">${esc(w?.definition ?? '—')}</small></span>${included ? dot(S.app.mastery(m.w)) : greyDot('Excluded')}</li>`;
      }).join('')}</ul>`).join('')}
  </main>`;
}

function reviseRounds() {
  const all = S.app.reviseRounds;
  const rounds = [...all].reverse();
  if (!rounds.length) {
    return '<p class="muted">No revise rounds yet. Start one from "Revise everything" on the Study tab: it shows every selected word once, and each round\'s result is kept here.</p>';
  }
  if (ui.revise.openId === undefined) ui.revise.openId = rounds[0].id;
  return rounds.map((r) => {
    const prev = all[r.number - 2];
    const expanded = ui.revise.openId === r.id;
    let since = '';
    if (prev) {
      const shared = [...r.results.keys()].filter((k) => prev.results.has(k));
      if (shared.length) {
        const fixed = shared.filter((k) => r.results.get(k) && !prev.results.get(k)).length;
        const slipped = shared.filter((k) => !r.results.get(k) && prev.results.get(k)).length;
        since = `<p class="small muted">Since round ${prev.number}: ${fixed} recovered, ${slipped} slipped</p>`;
      }
    }
    const dates = shortDate(r.firstMs) === shortDate(r.lastMs) ? shortDate(r.firstMs) : `${shortDate(r.firstMs)} – ${shortDate(r.lastMs)}`;
    const words = expanded ? [...r.results].filter(([, v]) => v === ui.revise.showRight).map(([k]) => k) : [];
    return `<section class="card tap" data-a="toggleRound" data-id="${r.id}">
        <div class="line"><h3>Round ${r.number}</h3><span class="small muted">${dates}</span></div>
        ${reviseBar(r.right, r.left, r.checked)}
        <p class="small">${r.checked} checked · ${r.right} right · ${r.left} left · ${pct(r.right / Math.max(1, r.checked))} right</p>
        ${since}
        <p class="label accent">${expanded ? 'Hide words' : 'Show words'}</p>
      </section>
      ${expanded ? `<div class="chips"><button class="chip ${!ui.revise.showRight ? 'on' : ''}" data-a="roundSide" data-right="0">Swiped left · ${r.left}</button><button class="chip ${ui.revise.showRight ? 'on' : ''}" data-a="roundSide" data-right="1">Swiped right · ${r.right}</button></div>
        <ul class="list">${words.map((k) => { const w = S.app.byKey.get(k); return `<li class="clword"><span><b>${esc(w?.word ?? k)}</b>${w ? `<small class="muted">${esc(w.definition)}</small>` : ''}</span></li>`; }).join('')}</ul>` : ''}`;
  }).join('');
}

// ---- Settings -----------------------------------------------------------------------

function slider(label, key, value, min, max, step, display) {
  return `<label class="slider"><span class="line"><span>${label}</span><b data-show="${key}">${display}</b></span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-setting="${key}"></label>`;
}

export const sliderDisplay = {
  [S.K.SESSION_SIZE]: (v) => `${v}`, [S.K.SESSIONS_PER_DAY]: (v) => `${v}`, [S.K.NEW_PER_DAY]: (v) => `${v}`,
  [S.K.RECOVERY]: (v) => `${v} min`, [S.K.RETENTION]: (v) => pct(Number(v)), [S.K.FAST]: (v) => ms(Number(v)),
  [S.K.SLOW]: (v) => ms(Number(v)), [S.K.QUESTIONS_PER_DAY]: (v) => `${v}`,
};

export function settingsScreen() {
  const s = S.app.settings;
  const d = new Date(s.examEpochMs);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sd = sliderDisplay;
  return `<main class="page">
    <h1>Settings</h1>
    <section class="card"><h3>Exam date</h3>
      <input type="date" class="date" value="${iso}" data-change="examDate">
      <p class="small muted">Intervals are never scheduled past this date, and the retention target tightens in the final five days.</p>
    </section>

    <section class="card"><h3>Your day</h3>
      ${slider('Cards per sitting', S.K.SESSION_SIZE, s.sessionSize, 10, 80, 5, sd[S.K.SESSION_SIZE](s.sessionSize))}
      ${slider('Sittings per day', S.K.SESSIONS_PER_DAY, s.sessionsPerDay, 1, 8, 1, sd[S.K.SESSIONS_PER_DAY](s.sessionsPerDay))}
      ${slider('New words per day', S.K.NEW_PER_DAY, s.newPerDay, 0, 60, 5, sd[S.K.NEW_PER_DAY](s.newPerDay))}
      <p class="small muted">That is ${s.sessionSize * s.sessionsPerDay} cards a day across ${s.sessionsPerDay} sitting${s.sessionsPerDay === 1 ? '' : 's'}, of which at most ${s.newPerDay} are words you have never seen. A sitting is always the size you set: what is not due is filled from the words you have already met, the weak ones likeliest.</p>
      <p class="small muted">Three to five short sittings beat one long one for the same total time. Leave an hour or so between them where you can, and put the last one shortly before sleep. The new word allowance is the lever that matters most: each new word generates roughly eight later reviews, so raising it costs you more tomorrow than today. Twenty a day is what most people sustain for a month.</p>
    </section>

    <section class="card"><h3>Sittings close together</h3>
      <p class="small muted">Every sitting is divided the same way: three in ten weak, three in ten shaky, two in ten good, one in ten solid, one in ten never seen before. Meeting more new words than that borrows from solid first, then good. Once the day's new words are done their share goes to shaky. Only the new words change when sittings come close together — that is what this window governs.</p>
      ${slider('Full effort again after', S.K.RECOVERY, s.recoveryMinutes, 5, 90, 5, sd[S.K.RECOVERY](s.recoveryMinutes))}
    </section>

    <section class="card"><h3>Scheduling</h3>
      ${slider('Target recall when a word comes back', S.K.RETENTION, s.desiredRetention, 0.8, 0.97, 0.01, sd[S.K.RETENTION](s.desiredRetention))}
      <p class="small muted">Higher means shorter intervals and more repetitions per word. 90% is the usual sweet spot between effort and retention.</p>
    </section>

    <section class="card"><h3>How answers are graded</h3>
      <p class="small muted">You answer with one of two swipes, but how long you took to recall the meaning — from the card appearing to your tap — decides how strong the answer counted as. Under ${ms(s.fastMs)} counts as effortless, up to ${ms(s.slowMs)} as normal, and slower than that as a struggle even when you got it right.</p>
      ${slider('Effortless under', S.K.FAST, s.fastMs, 800, 4000, 200, sd[S.K.FAST](s.fastMs))}
      ${slider('A struggle over', S.K.SLOW, s.slowMs, 3000, 15000, 1000, sd[S.K.SLOW](s.slowMs))}
    </section>

    <section class="card"><h3>GRE questions</h3>
      ${slider('Questions per day', S.K.QUESTIONS_PER_DAY, s.questionsPerDay, 1, 12, 1, sd[S.K.QUESTIONS_PER_DAY](s.questionsPerDay))}
      <p class="small muted">The daily goal shown on the Study tab. Take them from "Take a question" whenever you like.</p>
    </section>

    <section class="card"><h3>Strategy</h3>
      <p><b>${esc(strategy.displayName)}</b></p>
      <p class="small muted">${esc(strategy.summary)}</p>
      <p class="small muted">${S.app.totalEvents} answers are on record. Scheduling is recomputed from them every time the app opens, so replacing this strategy re-derives everything from your real history rather than starting over.</p>
    </section>

    <section class="card"><h3>Backup</h3>
      <p class="small muted">${s.lastBackupMs ? `Last exported ${fullDate(s.lastBackupMs)}, ${new Date(s.lastBackupMs).toTimeString().slice(0, 5)}.` : 'Not exported yet.'}</p>
      <p class="small muted">Your progress lives only on this device${isIOS() ? ', inside the home-screen app' : ''}. Export now and then to keep a copy (save it to Files or send it to yourself). Import merges a file back in without duplicating answers you already have, and accepts backups from the Android app too.</p>
      <div class="row"><button class="btn inline" data-a="exportBackup">Export</button><button class="btn outline inline" data-a="importBackup">Import</button></div>
      <input type="file" id="importFile" accept="application/json,.json,text/plain" hidden>
    </section>

    <p class="tiny muted center-text">Word origins: ${esc(S.etymology.credit || 'Wiktionary')}. Pronunciation uses your device's built-in voice.</p>
  </main>`;
}
