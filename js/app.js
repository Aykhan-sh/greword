// Entry point: routing, rendering, the click/input dispatch table, dialogs and toasts.

import * as S from './state.js';
import { ui, homeScreen, studyScreen, questionScreen, attachCardGestures, commit, nav, esc, attr } from './ui.js';
import { decksScreen, deckScreen, deckList, deckShown, statsScreen, statsList, clusterScreen, settingsScreen, sliderDisplay } from './screens.js';

const TAB_ROUTES = new Set(['home', 'decks', 'stats', 'settings']);
const root = document.getElementById('app');
const overlay = document.getElementById('overlay');
let lastRouteKey = '';

function screenHtml() {
  const r = ui.route;
  switch (r.name) {
    case 'home': return homeScreen();
    case 'decks': return decksScreen();
    case 'deck': return deckScreen(r.param);
    case 'stats': return statsScreen();
    case 'cluster': return clusterScreen(r.param);
    case 'settings': return settingsScreen();
    case 'study': return studyScreen();
    case 'question': return questionScreen();
    default: return homeScreen();
  }
}

function render() {
  if (!S.app.ready) return;
  const key = `${ui.route.name}:${ui.route.param ?? ''}:${ui.route.name === 'stats' ? ui.stats.tab : ''}`;
  const y = window.scrollY;
  const focusedInput = document.activeElement?.dataset?.input;
  root.className = TAB_ROUTES.has(ui.route.name) ? 'with-tabs' : '';
  root.innerHTML = screenHtml() + (TAB_ROUTES.has(ui.route.name) ? nav() : '');
  window.scrollTo(0, key === lastRouteKey ? y : 0);
  lastRouteKey = key;
  if (focusedInput) {
    const el = root.querySelector(`[data-input="${focusedInput}"]`);
    if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); }
  }
  if (ui.route.name === 'study') attachCardGestures();
  renderToast();
}

function go(name, param) {
  if (ui.route.name === 'question' && name !== 'question') S.abandonQuestion();
  if (name === 'deck' && ui.route.param !== param) ui.deckQuery = '';
  ui.route = { name, param };
  render();
}

// ---- dialogs and toasts -----------------------------------------------------------

function dialog(html, wire) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    const close = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return close(null);
      const b = e.target.closest('[data-d]');
      if (b) close(b.dataset.d === 'ok' ? (wire ? wire(wrap) : true) : b.dataset.d === 'no' ? null : b.dataset.d);
    });
    overlay.appendChild(wrap);
    wrap.querySelector('input,textarea')?.focus();
  });
}

const confirmDialog = (title, text, ok, cancel = 'Cancel') => dialog(
  `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="actions"><button class="text" data-d="no">${esc(cancel)}</button><button class="text strong" data-d="ok">${esc(ok)}</button></div>`,
);

async function wordDialog(initial) {
  const html = `<h3>${initial ? 'Edit word' : 'Add a word'}</h3>
    <label class="field">Word<input name="word" maxlength="80" value="${attr(initial?.word ?? '')}" ${initial ? 'disabled' : ''}></label>
    <label class="field">Meaning<textarea name="definition" rows="3" maxlength="600">${esc(initial?.definition ?? '')}</textarea></label>
    <label class="field">Example sentence<textarea name="example" rows="2" maxlength="600">${esc(initial?.example ?? '')}</textarea></label>
    ${initial ? '<button class="text error" data-d="delete">Delete this word</button>' : ''}
    <div class="actions"><button class="text" data-d="no">Cancel</button><button class="text strong" data-d="ok">${initial ? 'Save' : 'Add'}</button></div>`;
  const result = await dialog(html, (wrap) => ({
    word: wrap.querySelector('[name=word]').value,
    definition: wrap.querySelector('[name=definition]').value,
    example: wrap.querySelector('[name=example]').value,
  }));
  if (result === 'delete') {
    if (await confirmDialog(`Delete "${initial.word}"?`, 'This removes it and its study history for good.', 'Delete')) {
      await S.deleteCustomWord(initial.wordKey, initial.word);
    }
    return;
  }
  if (!result) return;
  try {
    if (initial) await S.updateCustomWord(initial.wordKey, result.definition, result.example);
    else await S.addCustomWord(result.word, result.definition, result.example);
  } catch (e) {
    S.showToast(e.message);
  }
}

let toastTimer = null;
let timedToast = null;
function renderToast() {
  overlay.querySelector('.toast')?.remove();
  const t = S.toast;
  if (!t) return;
  const el = document.createElement('div');
  el.className = `toast ${TAB_ROUTES.has(ui.route.name) ? 'above-tabs' : ''}`;
  el.innerHTML = `<span>${esc(t.message)}</span>${t.actionLabel ? `<button class="text strong" data-toast="1">${esc(t.actionLabel)}</button>` : ''}`;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-toast]')) t.action?.();
    S.clearToast();
  });
  overlay.appendChild(el);
  // The clock starts once per message, not on every re-render while it is showing.
  if (timedToast === t) return;
  timedToast = t;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (S.toast === t) S.clearToast(); }, t.actionLabel ? 6000 : 3500);
}

// ---- backup ----------------------------------------------------------------------

async function exportBackup() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `greword-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  const text = JSON.stringify(S.buildBackup());
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'GREWord backup' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }
    await S.markBackedUp();
    S.showToast('Backup written');
  } catch (e) {
    if (e?.name !== 'AbortError') S.showToast(`Export failed: ${e.message}`);
  }
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) { S.showToast('That file is too large to be a GREWord backup'); return; }
  try {
    const r = await S.restoreBackup(await file.text());
    S.showToast(`Restored ${r.added} reviews (${r.skipped} already present)`);
  } catch (e) {
    S.showToast(`Import failed: ${e.message}`);
  }
}

// ---- actions ------------------------------------------------------------------------

const actions = {
  go: (d) => go(d.r),
  startSession: () => { S.startSession(); go('study'); },
  startRevise: () => { S.startRevise(); go('study'); },
  openQuestion: () => { go('question'); S.pickQuestion(); },
  undo: () => S.undo(),
  toggleOrigin: () => { ui.card.showOrigin = !ui.card.showOrigin; render(); },
  toggleSynonyms: () => { ui.card.showSynonyms = !ui.card.showSynonyms; render(); },
  speak: () => {
    const card = S.currentCard();
    if (!card || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(card.word);
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  },
  exitStudy: async () => {
    const s = S.session;
    // A revise round loses nothing by stopping, so leaving it needs no confirmation.
    if (!s.revise) {
      const text = s.answered === 0
        ? 'You have not answered anything yet, so there is nothing to lose but the queue itself.'
        : `${s.answered === 1 ? 'Your one answer so far is' : `Your ${s.answered} answers so far are`} already saved. The rest of the queue is not, so leaving means building a new session next time.`;
      if (!(await confirmDialog('Leave this session?', text, 'Leave', 'Keep studying'))) return;
    }
    S.dismissSession();
    go('home');
  },
  confirmExclude: async () => {
    const card = S.currentCard();
    if (!card) return;
    if (await confirmDialog(`Stop showing "${card.word}"?`,
      'It leaves this session and every future one, and drops out of your statistics. Its history is kept, so putting it back restores everything — undo straight away from the message that follows, or re-tick it any time on the Decks tab.',
      'Exclude')) S.excludeCurrentWord();
  },
  doneStudy: () => { S.dismissSession(); go('home'); },
  leaveQuestion: () => go('home'),
  choose: (d) => S.selectChoice(Number(d.b), Number(d.c)),
  submitQuestion: () => S.submitQuestion(),
  nextQuestion: () => S.pickQuestion(true),

  allDecks: (d) => S.setAllDecks(d.on === '1'),
  deckToggle: (d, el) => S.setDeckEnabled(d.deck, el.checked),
  openDeck: (d) => go('deck', d.deck),
  wordToggle: (d, el) => S.setWordsIncluded([d.key], el.checked),
  wordToggleRow: (d) => S.setWordsIncluded([d.key], !S.app.wordIncluded(d.key)),
  deckWordsAll: (d) => S.setWordsIncluded(deckShown(ui.route.param).map((w) => w.wordKey), d.on === '1'),
  addWord: () => wordDialog(null),
  editWord: (d) => wordDialog(S.app.byKey.get(d.key)),

  statsTab: (d) => { ui.stats.tab = Number(d.i); render(); },
  statsFilter: (d) => { ui.stats.filter = ui.stats.filter === d.m ? null : d.m; render(); },
  statOpen: (d) => {
    ui.stats.open.has(d.key) ? ui.stats.open.delete(d.key) : ui.stats.open.add(d.key);
    document.getElementById('list').innerHTML = statsList();
  },
  openCluster: (d) => go('cluster', d.id),
  backToStats: () => go('stats'),
  toggleRound: (d) => { ui.revise.openId = ui.revise.openId === Number(d.id) ? null : Number(d.id); render(); },
  roundSide: (d) => { ui.revise.showRight = d.right === '1'; render(); },

  exportBackup,
  importBackup: () => document.getElementById('importFile')?.click(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled || !root.contains(el)) return;
  if (el.type === 'checkbox') return; // handled on change
  actions[el.dataset.a]?.(el.dataset, el);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.type === 'checkbox' && el.dataset.a) actions[el.dataset.a]?.(el.dataset, el);
  if (el.id === 'importFile') { importFile(el.files[0]); el.value = ''; }
  if (el.dataset.setting) S.putSetting(el.dataset.setting, el.dataset.setting === S.K.RETENTION ? Number(el.value).toFixed(2) : el.value);
  if (el.dataset.change === 'statsSort') { ui.stats.sort = el.value; document.getElementById('list').innerHTML = statsList(); }
  if (el.dataset.change === 'examDate' && el.value) {
    const [y, m, d] = el.value.split('-').map(Number);
    S.putSetting(S.K.EXAM, new Date(y, m - 1, d).getTime());
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.setting) {
    const show = root.querySelector(`[data-show="${el.dataset.setting}"]`);
    if (show) show.textContent = sliderDisplay[el.dataset.setting](el.value);
  }
  if (el.dataset.input === 'statsQuery') { ui.stats.query = el.value.slice(0, 80); document.getElementById('list').innerHTML = statsList(); }
  if (el.dataset.input === 'deckQuery') { ui.deckQuery = el.value.slice(0, 80); document.getElementById('list').innerHTML = deckList(ui.route.param); }
});

// Keyboard, for a laptop: space reveals, the arrows answer, backspace steps back.
document.addEventListener('keydown', (e) => {
  if (ui.route.name !== 'study' || overlay.querySelector('.modal') || e.target.closest?.('input,textarea')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); S.reveal(); }
  else if (e.key === 'ArrowRight') commit(true);
  else if (e.key === 'ArrowLeft') commit(false);
  else if (e.key === 'Backspace') S.undo();
});

// The question stopwatch ticks from the stored timestamp, so nothing it shows drifts.
setInterval(() => {
  const el = document.getElementById('qclock');
  const q = S.question;
  if (el && q.q && !q.submitted) {
    const t = Date.now() - q.shownAtMs;
    el.textContent = `${Math.floor(t / 60000)}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}`;
  }
}, 250);

// The day rolls over and due times pass while the app sits open on a tab screen.
// Skipped while a field is in use: a full re-render would close the keyboard or a picker.
const busy = () => overlay.querySelector('.modal') || document.activeElement?.matches?.('input,select,textarea');
setInterval(() => { if (TAB_ROUTES.has(ui.route.name) && !busy()) S.recompute(); }, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && TAB_ROUTES.has(ui.route.name)) S.recompute();
});

S.subscribe(render);

S.load().catch((e) => {
  root.innerHTML = `<main class="page center"><section class="card summary"><h2>Could not start</h2><p class="small error">${esc(e.message ?? e)}</p></section></main>`;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
