// The web counterpart of AppViewModel and Repository: loads content, holds the raw log in
// memory, rebuilds every derived figure from it, and exposes the actions the screens call.

import * as db from './db.js';
import {
  strategy, Revise, buildClusters, parseQuestions, nextQuestion, questionTally,
  isCorrect, isComplete, picksPerBlank, DAY_MS,
} from './core.js';

export const CUSTOM_DECK = 'My Words';
const CUSTOM_DECK_ORDER = 1_000_000;
const BACKUP_FORMAT = 'greword-backup';
const CONTENT_HASH_KEY = 'content_hash';

export const K = {
  EXAM: 'exam_epoch_ms', SESSION_SIZE: 'session_size', SESSIONS_PER_DAY: 'sessions_per_day',
  NEW_PER_DAY: 'new_per_day', RECOVERY: 'recovery_minutes', RETENTION: 'desired_retention',
  FAST: 'fast_ms', SLOW: 'slow_ms', LAST_BACKUP: 'last_backup_ms', QUESTIONS_PER_DAY: 'questions_per_day',
};

const normalise = (w) => w.trim().toLowerCase();

function settingsFrom(m, now) {
  const num = (k, d) => (m[k] != null && m[k] !== '' && Number.isFinite(Number(m[k])) ? Number(m[k]) : d);
  return {
    examEpochMs: num(K.EXAM, now + 30 * DAY_MS),
    sessionSize: num(K.SESSION_SIZE, 30),
    sessionsPerDay: num(K.SESSIONS_PER_DAY, 4),
    newPerDay: num(K.NEW_PER_DAY, 20),
    recoveryMinutes: num(K.RECOVERY, 20),
    desiredRetention: num(K.RETENTION, 0.9),
    fastMs: num(K.FAST, 1800),
    slowMs: num(K.SLOW, 5000),
    lastBackupMs: num(K.LAST_BACKUP, 0),
    questionsPerDay: num(K.QUESTIONS_PER_DAY, 5),
  };
}

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

// ---- stored state, mirrored in memory ------------------------------------------

let builtIn = [];          // words from words.json, in source order
let customWords = [];      // "My Words"
let deckPrefs = {};
let wordPrefs = {};
let settingsMap = {};
let events = [];           // the review log, with ids
let answers = [];          // answered GRE questions
let qstate = {};           // id -> {answered, lastShownMs}
let questions = [];
let questionBankError = null;
export let clusters = buildClusters(null);
export let etymology = { words: {}, credit: '' };

export let app = { ready: false };
export let session = blankSession();
export let question = { loading: true };
export let toast = null;

const undoStack = [];

function blankSession() {
  return { active: false, finished: false, queue: [], index: 0, answered: 0, correct: 0, canUndo: false };
}

// ---- loading ------------------------------------------------------------------

export async function load() {
  const get = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
  const [words, clusterFile, ety, qfile] = await Promise.all([
    get('data/words.json'), get('data/clusters.json').catch(() => null),
    get('data/etymology.json').catch(() => null), get('data/questions.json').catch((e) => ({ error: e })),
  ]);

  builtIn = [];
  words.decks.forEach((deck, deckOrder) => deck.words.forEach((w, i) => builtIn.push({
    wordKey: normalise(w.word), word: w.word.trim(), deck: deck.name, deckOrder,
    definition: (w.definition ?? '').trim(), example: (w.example ?? '').trim(), orderInDeck: i, isCustom: false,
  })));
  clusters = buildClusters(clusterFile);
  if (ety) etymology = { words: ety.words ?? {}, credit: ety.source ? `${ety.source} · ${ety.license}` : '' };
  try {
    if (qfile.error) throw qfile.error;
    questions = parseQuestions(qfile);
  } catch (e) {
    questionBankError = e.message ?? String(e);
  }

  [customWords, deckPrefs, wordPrefs, settingsMap, qstate, events, answers] = await Promise.all([
    db.kvGet('customWords', []), db.kvGet('deckPrefs', {}), db.kvGet('wordPrefs', {}),
    db.kvGet('settings', {}), db.kvGet('qstate', {}), db.getAll('events'), db.getAll('answers'),
  ]);
  events.sort((a, b) => a.tsMs - b.tsMs || a.id - b.id);

  // The default exam date is a month out; pin it on first run so it does not slide.
  if (settingsMap[K.EXAM] == null) {
    settingsMap[K.EXAM] = String(Date.now() + 30 * DAY_MS);
    await db.kvPut('settings', settingsMap);
  }
  navigator.storage?.persist?.().catch(() => {});
  recompute();
}

export function recompute() {
  const now = Date.now();
  const settings = settingsFrom(settingsMap, now);
  const cfg = settings;
  const words = [...builtIn, ...customWords.map((w) => ({ ...w, deck: CUSTOM_DECK, deckOrder: CUSTOM_DECK_ORDER, isCustom: true }))];
  const byKey = new Map(words.map((w) => [w.wordKey, w]));
  const deckEnabled = (d) => deckPrefs[d] !== false;
  const wordIncluded = (k) => wordPrefs[k] !== false;
  const progress = strategy.replay(events, cfg, now);
  const eligible = words
    .filter((w) => deckEnabled(w.deck) && wordIncluded(w.wordKey))
    .map((w) => ({ wordKey: w.wordKey, deck: w.deck, clusters: clusters.axesOf.get(w.wordKey) ?? new Set() }));
  app = {
    ready: true, words, byKey, settings, cfg, progress, eligible,
    decks: [...new Set([...words.map((w) => w.deck), CUSTOM_DECK])],
    deckEnabled, wordIncluded,
    day: strategy.dayContext(events, now),
    reviseRounds: Revise.rounds(events),
    questionTally: questionTally(answers, strategy.dayStart(now), settings.questionsPerDay),
    totalEvents: events.length,
    computedAt: now,
    mastery: (k) => strategy.mastery(progress.get(k)),
  };
  emit();
}

export function showToast(message, actionLabel = null, action = null) {
  toast = { message, actionLabel, action, at: Date.now() };
  emit();
}
export function clearToast() { toast = null; emit(); }

// ---- selection ------------------------------------------------------------------

export async function setDeckEnabled(deck, on) {
  deckPrefs = { ...deckPrefs, [deck]: on };
  recompute();
  await db.kvPut('deckPrefs', deckPrefs);
}

export async function setAllDecks(on) {
  deckPrefs = Object.fromEntries(app.decks.map((d) => [d, on]));
  recompute();
  await db.kvPut('deckPrefs', deckPrefs);
}

export async function setWordsIncluded(keys, on) {
  wordPrefs = { ...wordPrefs };
  for (const k of keys) wordPrefs[k] = on;
  recompute();
  await db.kvPut('wordPrefs', wordPrefs);
}

// ---- "My Words" -----------------------------------------------------------------

export async function addCustomWord(word, definition, example) {
  const key = normalise(word);
  if (!word.trim() || !definition.trim()) throw new Error('A word and its meaning are both required');
  if (app.byKey.has(key)) throw new Error(`"${word.trim()}" is already in your list`);
  const nextOrder = customWords.reduce((m, w) => Math.max(m, w.orderInDeck), -1) + 1;
  customWords = [...customWords, { wordKey: key, word: word.trim(), definition: definition.trim(), example: example.trim(), orderInDeck: nextOrder }];
  await db.kvPut('customWords', customWords);
  recompute();
  showToast(`"${word.trim()}" added to My Words`);
}

/** The headword cannot change: that would move its review history to a new key. */
export async function updateCustomWord(key, definition, example) {
  if (!definition.trim()) throw new Error('A meaning is required');
  customWords = customWords.map((w) => (w.wordKey === key ? { ...w, definition: definition.trim(), example: example.trim() } : w));
  await db.kvPut('customWords', customWords);
  recompute();
}

export async function deleteCustomWord(key, word) {
  customWords = customWords.filter((w) => w.wordKey !== key);
  await db.kvPut('customWords', customWords);
  recompute();
  showToast(`"${word}" removed`);
}

// ---- settings ---------------------------------------------------------------------

export async function putSetting(key, value) {
  settingsMap = { ...settingsMap, [key]: String(value) };
  recompute();
  await db.kvPut('settings', settingsMap);
}

// ---- study sessions -----------------------------------------------------------------

function cardFor(key, now) {
  const w = app.byKey.get(key);
  if (!w) return null;
  const n = clusters.neighboursOf(key);
  const display = (k) => app.byKey.get(k)?.word ?? k;
  return {
    wordKey: key, word: w.word, definition: w.definition, example: w.example, deck: w.deck,
    attempt: 0, isNew: (app.progress.get(key)?.reps ?? 0) === 0,
    synonyms: n.synonyms.map(display), opposite: n.opposite == null ? null : display(n.opposite), sense: n.sense,
    mastery: app.mastery(key),
  };
}

export function currentPlan() {
  return strategy.plan(app.progress, app.eligible, app.cfg, app.computedAt, app.computedAt, app.day);
}

export function startSession() {
  if (!app.ready) return;
  recompute();
  const now = Date.now();
  const plan = strategy.plan(app.progress, app.eligible, app.cfg, now, now, app.day);
  const cards = plan.queue.map((k) => cardFor(k, now)).filter(Boolean);
  undoStack.length = 0;
  session = {
    ...blankSession(), active: cards.length > 0, finished: cards.length === 0,
    sessionId: crypto.randomUUID(), queue: cards, revealed: false, shownAtMs: now, revealAtMs: 0, startedAtMs: now, plan,
  };
  emit();
}

/** Continue the open revise round, or start the next one. */
export function startRevise() {
  if (!app.ready) return;
  recompute();
  const now = Date.now();
  const selected = app.eligible.map((w) => w.wordKey);
  const open = Revise.open(app.reviseRounds, selected);
  const cards = Revise.remaining(selected, open, app.progress).map((k) => cardFor(k, now)).filter(Boolean);
  const roundId = open?.id ?? now;
  const selectedSet = new Set(selected);
  const earlier = open ? [...open.results].filter(([k]) => selectedSet.has(k)) : [];
  undoStack.length = 0;
  session = {
    ...blankSession(), active: cards.length > 0, finished: cards.length === 0,
    sessionId: Revise.sessionId(roundId), queue: cards, revealed: false, shownAtMs: now, revealAtMs: 0, startedAtMs: now,
    revise: {
      roundId,
      roundNumber: open?.number ?? ((app.reviseRounds.at(-1)?.number ?? 0) + 1),
      roundSize: selected.length,
      checkedBefore: earlier.length,
      rightBefore: earlier.filter(([, v]) => v).length,
    },
  };
  emit();
}

export const currentCard = () => session.queue[session.index] ?? null;

export function reveal() {
  if (!session.active || session.revealed) return;
  session = { ...session, revealed: true, revealAtMs: Date.now() };
  emit();
}

/** `expect` is the card key the swipe began on; an undo in between makes the swipe stale. */
export async function answer(correct, expect = null) {
  const cur = session;
  const card = currentCard();
  if (!card || !cur.revealed) return;
  if (expect != null && expect !== `${cur.sessionId}:${cur.index}`) return;
  const now = Date.now();
  const event = {
    wordKey: card.wordKey, tsMs: now, shownAtMs: cur.shownAtMs,
    revealLatencyMs: Math.max(0, cur.revealAtMs - cur.shownAtMs),
    answerLatencyMs: Math.max(0, now - cur.revealAtMs),
    correct, sessionId: cur.sessionId, deckAtTime: card.deck, strategyId: strategy.id,
    inSessionAttempt: card.attempt, eventSchema: 1,
  };
  // A missed word comes back later in the same session; a revise round shows each word once.
  const queue = cur.queue.slice();
  if (!correct && card.attempt < 2 && !cur.revise) {
    const gap = strategy.relearnGap(card.attempt + 1);
    queue.splice(Math.min(cur.index + 1 + gap, queue.length), 0, { ...card, attempt: card.attempt + 1 });
  }
  const nextIndex = cur.index + 1;
  const finished = nextIndex >= queue.length;
  session = {
    ...cur, queue, index: nextIndex, revealed: false, shownAtMs: Date.now(), revealAtMs: 0,
    answered: cur.answered + 1, correct: cur.correct + (correct ? 1 : 0), finished, active: !finished, canUndo: true,
  };
  // The frame goes on the stack before the write, so an undo tapped while the write is in
  // flight pops this answer rather than the one before it.
  const write = db.add('events', event);
  undoStack.push({
    eventId: write, queue: cur.queue, index: cur.index, answered: cur.answered, correct: cur.correct,
    // Going back restores the card's own clock, so a correction changes direction only.
    shownAtMs: cur.shownAtMs, revealAtMs: cur.revealAtMs,
  });
  while (undoStack.length > 20) undoStack.shift();
  emit();

  try {
    const id = await write;
    events.push({ ...event, id });
    recompute();
  } catch (e) {
    showToast(`Could not save that answer: ${e?.message ?? e}`);
  }
}

export async function undo() {
  const frame = undoStack.pop();
  if (!frame) return;
  let id;
  try { id = await frame.eventId; } catch { id = null; }
  if (id != null) {
    await db.remove('events', id);
    events = events.filter((e) => e.id !== id);
  }
  session = {
    ...session, queue: frame.queue, index: frame.index, revealed: true, shownAtMs: frame.shownAtMs,
    revealAtMs: frame.revealAtMs, answered: frame.answered, correct: frame.correct,
    finished: false, active: true, canUndo: undoStack.length > 0,
  };
  recompute();
}

/** Retire the word on screen from this session and every future one, with undo. */
export async function excludeCurrentWord() {
  const before = session;
  const card = currentCard();
  if (!card) return;
  const queue = [...before.queue.slice(0, before.index), ...before.queue.slice(before.index).filter((c) => c.wordKey !== card.wordKey)];
  const finished = before.index >= queue.length;
  session = { ...before, queue, revealed: false, shownAtMs: Date.now(), revealAtMs: 0, finished, active: !finished };
  await setWordsIncluded([card.wordKey], false);
  showToast(`"${card.word}" will not come up again`, 'Undo', () => {
    setWordsIncluded([card.wordKey], true);
    // A revealed card keeps its recall time; an unrevealed one restarts its clock.
    session = before.revealed ? before : { ...before, shownAtMs: Date.now(), revealAtMs: 0 };
    emit();
  });
}

export function endSession() {
  session = { ...session, active: false, finished: true };
  emit();
}

export function dismissSession() {
  undoStack.length = 0;
  session = blankSession();
  emit();
}

// ---- GRE questions -----------------------------------------------------------------

async function saveQState() { await db.kvPut('qstate', qstate); }

/** Pick a question unless one is already in progress (or force it). */
export async function pickQuestion(force = false) {
  if (!force && question.q && !question.submitted) return;
  if (questionBankError) { question = { loading: false, bankError: questionBankError }; emit(); return; }
  const rows = questions.map((q) => ({ id: q.id, answered: !!qstate[q.id]?.answered, lastShownMs: qstate[q.id]?.lastShownMs ?? 0 }));
  const passed = new Set(answers.filter((a) => a.correct).map((a) => a.questionId));
  const pick = nextQuestion(rows, passed);
  if (!pick) {
    question = {
      loading: false,
      bankError: rows.length ? 'You have passed every question in the bank. A larger bank will bring new ones.' : 'The question bank is empty.',
    };
    emit();
    return;
  }
  if (pick.newCycle) for (const id of Object.keys(qstate)) qstate[id] = { ...qstate[id], answered: false };
  const now = Date.now();
  qstate[pick.id] = { ...qstate[pick.id], lastShownMs: now };
  const q = questions.find((x) => x.id === pick.id);
  question = { loading: false, q, shownAtMs: now, selection: q.blanks.map(() => new Set()), submitted: false };
  emit();
  await saveQState();
}

/** Leaving drops the question; a stopwatch that ran while away means nothing. */
export function abandonQuestion() {
  if (question.q && !question.submitted) { question = { loading: true }; emit(); }
}

export function selectChoice(blank, choice) {
  const q = question.q;
  if (!q || question.submitted) return;
  const chosen = question.selection[blank];
  let next;
  if (chosen.has(choice)) next = new Set([...chosen].filter((c) => c !== choice));
  else if (picksPerBlank(q) === 1) next = new Set([choice]);
  else if (chosen.size < picksPerBlank(q)) next = new Set([...chosen, choice]);
  else next = chosen;
  const selection = question.selection.slice();
  selection[blank] = next;
  question = { ...question, selection };
  emit();
}

export async function submitQuestion() {
  const q = question.q;
  if (!q || question.submitted || !isComplete(q, question.selection)) return;
  const now = Date.now();
  const correct = isCorrect(q, question.selection);
  const elapsedMs = Math.max(0, now - question.shownAtMs);
  question = { ...question, submitted: true, elapsedMs, correct };
  emit();
  qstate[q.id] = { ...qstate[q.id], answered: true };
  await saveQState();
  const row = { questionId: q.id, tsMs: now, correct, elapsedMs };
  row.id = await db.add('answers', row);
  answers.push(row);
  recompute();
}

// ---- backup (same file format as the Android app, version 3) ------------------------

export function buildBackup() {
  return {
    format: BACKUP_FORMAT, version: 3, exportedAtMs: Date.now(),
    events: events.map(({ id, ...e }) => e),
    questionAnswers: answers.map(({ questionId, tsMs, correct, elapsedMs }) => ({ questionId, tsMs, correct, elapsedMs })),
    deckPrefs, wordPrefs, settings: settingsMap,
    customWords: customWords.map(({ wordKey, word, definition, example, orderInDeck }) => ({ wordKey, word, definition, example, orderInDeck })),
  };
}

export async function markBackedUp() { await putSetting(K.LAST_BACKUP, Date.now()); }

/** Additive for the log: answers already present are skipped, never duplicated. */
export async function restoreBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('That file is not valid JSON'); }
  if (b?.format !== BACKUP_FORMAT) throw new Error('Not a GREWord backup file');
  const fp = (e) => `${e.wordKey}|${e.tsMs}|${e.shownAtMs}|${e.revealLatencyMs}`;
  const known = new Set(events.map(fp));
  const toAdd = [];
  let skipped = 0;
  for (const e of b.events ?? []) {
    if (typeof e?.wordKey !== 'string' || !Number.isFinite(e.tsMs)) { skipped++; continue; }
    if (known.has(fp(e))) { skipped++; continue; }
    known.add(fp(e));
    toAdd.push({
      wordKey: e.wordKey, tsMs: e.tsMs, shownAtMs: Number(e.shownAtMs) || 0, revealLatencyMs: Number(e.revealLatencyMs) || 0,
      answerLatencyMs: Number(e.answerLatencyMs) || 0, correct: !!e.correct, sessionId: String(e.sessionId ?? ''),
      deckAtTime: String(e.deckAtTime ?? ''), strategyId: String(e.strategyId ?? ''),
      inSessionAttempt: Number(e.inSessionAttempt) || 0, eventSchema: Number(e.eventSchema) || 1,
    });
  }
  await db.addMany('events', toAdd);

  const knownAnswers = new Set(answers.map((a) => `${a.questionId}|${a.tsMs}`));
  const answersToAdd = (b.questionAnswers ?? [])
    .filter((a) => {
      if (typeof a?.questionId !== 'string' || !Number.isFinite(a.tsMs)) return false;
      const k = `${a.questionId}|${a.tsMs}`;
      if (knownAnswers.has(k)) return false;
      knownAnswers.add(k);
      return true;
    })
    .map((a) => ({ questionId: a.questionId, tsMs: a.tsMs, correct: !!a.correct, elapsedMs: Number(a.elapsedMs) || 0 }));
  await db.addMany('answers', answersToAdd);

  deckPrefs = { ...deckPrefs, ...(b.deckPrefs ?? {}) };
  wordPrefs = { ...wordPrefs, ...(b.wordPrefs ?? {}) };
  const incoming = { ...(b.settings ?? {}) };
  delete incoming[CONTENT_HASH_KEY];
  settingsMap = { ...settingsMap, ...incoming };

  // A custom word already here wins, so an old backup cannot undo a newer edit.
  const live = new Set([...customWords.map((w) => w.wordKey), ...builtIn.map((w) => w.wordKey)]);
  const newCustom = (b.customWords ?? []).filter((w) => {
    if (typeof w?.wordKey !== 'string' || typeof w.word !== 'string' || live.has(w.wordKey)) return false;
    live.add(w.wordKey);
    return true;
  });
  customWords = [...customWords, ...newCustom.map(({ wordKey, word, definition, example, orderInDeck }) =>
    ({ wordKey, word: String(word), definition: String(definition), example: String(example ?? ''), orderInDeck: Number(orderInDeck) || 0 }))];
  for (const w of newCustom) wordPrefs[w.wordKey] = true;

  await Promise.all([
    db.kvPut('deckPrefs', deckPrefs), db.kvPut('wordPrefs', wordPrefs),
    db.kvPut('settings', settingsMap), db.kvPut('customWords', customWords),
  ]);
  [events, answers] = await Promise.all([db.getAll('events'), db.getAll('answers')]);
  events.sort((a, b) => a.tsMs - b.tsMs || a.id - b.id);
  recompute();
  return { added: toAdd.length, skipped };
}
