// Pure logic ported from the Android app: FSRS-6, the sprint strategy, revise rounds,
// the question bank and the meaning map. No DOM and no storage, so it mirrors the
// Kotlin sources (app/src/main/java/com/aykhan/greword/strategy, data) line for line
// where it can. Keep the two in step when either changes.

export const DAY_MS = 86_400_000;

export const Mastery = { UNSEEN: 'UNSEEN', WEAK: 'WEAK', SHAKY: 'SHAKY', GOOD: 'GOOD', SOLID: 'SOLID' };

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// Kotlin's kotlin.random.Random(seed) is not reproducible here; any seeded generator
// does, since the seed is only ever the current time.
export function rng(seed) {
  let a = (Number(seed) >>> 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// ---- FSRS-6 -----------------------------------------------------------------

export const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;
const MIN_D = 1, MAX_D = 10, MIN_S = 0.001;
const W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
  1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
  1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

export class FsrsScheduler {
  constructor(desiredRetention = 0.9, maximumIntervalDays = 21) {
    this.w = W;
    this.desiredRetention = desiredRetention;
    this.maximumIntervalDays = maximumIntervalDays;
    this.decay = -W[20];
    this.factor = Math.pow(0.9, 1 / this.decay) - 1;
  }
  clampD(d) { return clamp(d, MIN_D, MAX_D); }
  clampS(s) { return Math.max(s, MIN_S); }
  retrievability(stability, elapsedDays) {
    if (stability <= 0) return 0;
    const e = Math.max(elapsedDays, 0);
    return Math.pow(1 + this.factor * e / stability, this.decay);
  }
  intervalDays(stability) {
    const raw = (stability / this.factor) * (Math.pow(this.desiredRetention, 1 / this.decay) - 1);
    return Math.min(Math.max(Math.round(raw), 1), this.maximumIntervalDays);
  }
  initialMemory(rating) {
    return { stability: this.clampS(this.w[rating - 1]), difficulty: this.clampD(this.initialDifficulty(rating)) };
  }
  initialDifficulty(rating, doClamp = true) {
    const d = this.w[4] - Math.pow(Math.E, this.w[5] * (rating - 1)) + 1;
    return doClamp ? this.clampD(d) : d;
  }
  nextDifficulty(difficulty, rating) {
    const deltaD = -(this.w[6] * (rating - 3));
    const damped = difficulty + (10 - difficulty) * deltaD / 9;
    const reverted = this.w[7] * this.initialDifficulty(EASY, false) + (1 - this.w[7]) * damped;
    return this.clampD(reverted);
  }
  shortTermStability(stability, rating) {
    let inc = Math.pow(Math.E, this.w[17] * (rating - 3 + this.w[18])) * Math.pow(stability, -this.w[19]);
    if (rating !== AGAIN) inc = Math.max(inc, 1);
    return this.clampS(stability * inc);
  }
  forgetStability(difficulty, stability, r) {
    const w = this.w;
    const longTerm = w[11] * Math.pow(difficulty, -w[12]) *
      (Math.pow(stability + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
    const shortTerm = stability / Math.pow(Math.E, w[17] * w[18]);
    return Math.min(longTerm, shortTerm);
  }
  recallStability(difficulty, stability, r, rating) {
    const w = this.w;
    const hardPenalty = rating === HARD ? w[15] : 1;
    const easyBonus = rating === EASY ? w[16] : 1;
    return stability * (1 + Math.pow(Math.E, w[8]) * (11 - difficulty) * Math.pow(stability, -w[9]) *
      (Math.exp((1 - r) * w[10]) - 1) * hardPenalty * easyBonus);
  }
  review(prev, rating, elapsedDays) {
    if (prev == null || elapsedDays == null) return this.initialMemory(rating);
    let s;
    if (elapsedDays < 1) {
      s = this.shortTermStability(prev.stability, rating);
    } else {
      const r = this.retrievability(prev.stability, elapsedDays);
      s = rating === AGAIN
        ? this.forgetStability(prev.difficulty, prev.stability, r)
        : this.recallStability(prev.difficulty, prev.stability, r, rating);
    }
    // Difficulty is updated after stability, and stability uses the old difficulty.
    return { stability: this.clampS(s), difficulty: this.nextDifficulty(prev.difficulty, rating) };
  }
}

// ---- revise rounds ------------------------------------------------------------

const REVISE = 'revise:';

export const Revise = {
  sessionId: (roundId) => `${REVISE}${roundId}:${crypto.randomUUID()}`,
  isRevise: (sid) => sid.startsWith(REVISE),
  roundOf(sid) {
    if (!sid.startsWith(REVISE)) return null;
    const id = sid.slice(REVISE.length).split(':')[0];
    return /^-?\d+$/.test(id) ? Number(id) : null;
  },
  /** Every round in the log, oldest first, numbered from 1. */
  rounds(events) {
    const byRound = new Map();
    for (const e of events) {
      const id = Revise.roundOf(e.sessionId);
      if (id == null) continue;
      if (!byRound.has(id)) byRound.set(id, []);
      byRound.get(id).push(e);
    }
    return [...byRound.keys()].sort((a, b) => a - b).map((id, i) => {
      const rows = byRound.get(id).slice().sort((a, b) => a.tsMs - b.tsMs);
      // A word's verdict in a round is its first answer there.
      const results = new Map();
      for (const r of rows) if (!results.has(r.wordKey)) results.set(r.wordKey, r.correct);
      let right = 0;
      for (const v of results.values()) if (v) right++;
      return {
        id, number: i + 1,
        firstMs: rows[0].tsMs, lastMs: rows[rows.length - 1].tsMs,
        results, checked: results.size, right, left: results.size - right,
      };
    });
  },
  /** The latest round while it still has selected words left to check. */
  open(rounds, selected) {
    const r = rounds[rounds.length - 1];
    return r && selected.some((k) => !r.results.has(k)) ? r : null;
  },
  /** What is left to check, longest unseen first; never-reviewed words go last. */
  remaining(selected, round, progress) {
    return selected
      .filter((k) => round == null || !round.results.has(k))
      .sort((a, b) => {
        const ua = (progress.get(a)?.reps ?? 0) === 0, ub = (progress.get(b)?.reps ?? 0) === 0;
        if (ua !== ub) return ua ? 1 : -1;
        const la = progress.get(a)?.lastReviewMs ?? 0, lb = progress.get(b)?.lastReviewMs ?? 0;
        if (la !== lb) return la - lb;
        return a < b ? -1 : a > b ? 1 : 0;
      });
  },
};

// ---- the sprint strategy --------------------------------------------------------

const MIN_READINESS = 0.15;
const TOP_UP_MAX_RECALL = 0.98;
const FILL_WEIGHTS = [[Mastery.WEAK, 4], [Mastery.SHAKY, 3], [Mastery.GOOD, 2], [Mastery.SOLID, 1]];
const LEARNING_THRESHOLD_DAYS = 1;
const SHARE_NEW = 0.10, SHARE_WEAK = 0.30, SHARE_SHAKY = 0.30, SHARE_GOOD = 0.20, SHARE_SOLID = 0.10;
const WEIGHT_ACCURACY = 0.30, WEIGHT_RECENT = 0.25, WEIGHT_RETENTION = 0.20, WEIGHT_SPEED = 0.15, WEIGHT_DURABILITY = 0.10;
const DURABILITY_REFERENCE_DAYS = 14;
const RECENCY_DECAY = 0.6;
const LAPSE_PENALTY = 0.5;
const EXTRA_SITTING_NEW_SHARE = 0.15;
const MAX_LATENCY_MS = 60_000;

export const strategy = {
  id: 'fsrs6-sprint-v2',
  displayName: 'FSRS-6 exam sprint',
  summary:
    'Spaced repetition (FSRS-6) with latency-graded answers, a daily allowance of new ' +
    'words spread over several sittings, a review mix that eases towards familiar ' +
    'words when sittings come close together, deck and meaning interleaving, and ' +
    'intervals capped to your exam date.',

  daysUntilExam(cfg, now) {
    return Math.max(1, Math.ceil((cfg.examEpochMs - now) / DAY_MS));
  },

  scheduler(cfg, now) {
    const daysLeft = this.daysUntilExam(cfg, now);
    const retention = daysLeft <= 5 ? Math.max(cfg.desiredRetention, 0.95) : cfg.desiredRetention;
    return new FsrsScheduler(clamp(retention, 0.7, 0.98), Math.min(21, Math.max(1, daysLeft)));
  },

  rate(record, cfg) {
    if (!record.correct) return AGAIN;
    const t = record.revealLatencyMs;
    if (t >= 0 && t <= cfg.fastMs) return EASY;
    if (t <= cfg.slowMs) return GOOD;
    return HARD;
  },

  /** Rebuild all derived state from the full raw log. Returns Map<wordKey, progress>. */
  replay(events, cfg, now) {
    const fsrs = this.scheduler(cfg, now);
    const byWord = groupBy(events, (e) => e.wordKey);
    const out = new Map();
    const recoveryMs = cfg.recoveryMinutes * 60_000;
    for (const [key, raw] of byWord) {
      const list = raw.slice().sort((a, b) => a.tsMs - b.tsMs);
      let mem = null, lastTs = 0, reps = 0, lapses = 0, correct = 0, lastCorrect = null;
      const latencies = [], recent = [];
      for (const r of list) {
        const grade = this.rate(r, cfg);
        const elapsedMs = mem == null ? null : r.tsMs - lastTs;
        const elapsedDays = elapsedMs == null ? null : elapsedMs / DAY_MS;
        // A learning word graduates on a correct answer given across a gap; a correct
        // answer within the same sitting is the relearn step and does not graduate it.
        const learning = mem != null && (mem.stability < LEARNING_THRESHOLD_DAYS || lastCorrect === false);
        const reviewed = fsrs.review(mem, grade, elapsedDays);
        mem = learning && r.correct && elapsedMs >= recoveryMs
          ? { ...reviewed, stability: Math.max(reviewed.stability, fsrs.initialMemory(grade).stability) }
          : reviewed;
        lastTs = r.tsMs;
        lastCorrect = r.correct;
        reps++;
        if (r.correct) correct++; else lapses++;
        latencies.push(Math.min(r.revealLatencyMs, MAX_LATENCY_MS));
        recent.push(r.correct);
      }
      const stillLearning = mem.stability < LEARNING_THRESHOLD_DAYS || lastCorrect === false;
      const dueMs = stillLearning ? lastTs + recoveryMs : lastTs + fsrs.intervalDays(mem.stability) * DAY_MS;
      latencies.sort((a, b) => a - b);
      out.set(key, {
        wordKey: key, memory: mem, lastReviewMs: lastTs, dueMs, reps, lapses, correctCount: correct,
        medianRevealMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0,
        recentCorrect: recent.slice(-5),
        accuracy: reps === 0 ? 0 : correct / reps,
        stabilityDays: mem?.stability ?? 0,
      });
    }
    return out;
  },

  recallNow(p, cfg, now) {
    if (!p?.memory) return 0;
    return this.scheduler(cfg, now).retrievability(p.memory.stability, (now - p.lastReviewMs) / DAY_MS);
  },

  /** How well a word is held, 0..1, blending the whole record rather than any one number. */
  confidence(p, cfg, now) {
    if (!p || p.reps === 0) return 0;
    const accuracy = p.accuracy;
    let recent = accuracy;
    if (p.recentCorrect.length) {
      let weight = 1, hit = 0, total = 0;
      for (let i = p.recentCorrect.length - 1; i >= 0; i--) {
        if (p.recentCorrect[i]) hit += weight;
        total += weight;
        weight *= RECENCY_DECAY;
      }
      recent = total <= 0 ? accuracy : hit / total;
    }
    const speed = 1 - clamp(p.medianRevealMs / Math.max(1, cfg.slowMs), 0, 1);
    const durability = clamp(p.stabilityDays / DURABILITY_REFERENCE_DAYS, 0, 1);
    const retention = this.recallNow(p, cfg, now);
    const blended = WEIGHT_ACCURACY * accuracy + WEIGHT_RECENT * recent + WEIGHT_SPEED * speed +
      WEIGHT_DURABILITY * durability + WEIGHT_RETENTION * retention;
    const penalty = p.recentCorrect[p.recentCorrect.length - 1] === false ? LAPSE_PENALTY : 1;
    return clamp(blended * penalty, 0, 1);
  },

  mastery(p) {
    if (!p || p.reps === 0) return Mastery.UNSEEN;
    const lastWrong = p.recentCorrect[p.recentCorrect.length - 1] === false;
    const s = p.stabilityDays;
    if (lastWrong || s < 1) return Mastery.WEAK;
    if (s < 4) return Mastery.SHAKY;
    if (s < 10) return Mastery.GOOD;
    return Mastery.SOLID;
  },

  relearnGap(attempt) { return attempt === 1 ? 5 : attempt === 2 ? 12 : 20; },

  /** The start of the study day containing now: local midnight. */
  dayStart(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  },

  dayContext(events, now) {
    if (!events.length) return { sessionsToday: 0, lastSessionEndMs: null, newWordsToday: 0 };
    const start = this.dayStart(now);
    const firstSeen = new Map();
    const sessions = new Set();
    let lastEnd = 0, newToday = 0;
    for (const e of events) {
      const prev = firstSeen.get(e.wordKey);
      if (prev == null || e.tsMs < prev) firstSeen.set(e.wordKey, e.tsMs);
      if (e.tsMs >= start) {
        // A revise sitting does not use up a planned sitting; it still counts as recent effort.
        if (!Revise.isRevise(e.sessionId)) sessions.add(e.sessionId);
        if (e.tsMs > lastEnd) lastEnd = e.tsMs;
      }
    }
    for (const first of firstSeen.values()) if (first >= start) newToday++;
    return { sessionsToday: sessions.size, lastSessionEndMs: lastEnd > 0 ? lastEnd : null, newWordsToday: newToday };
  },

  rested(day, cfg, now) {
    if (day.lastSessionEndMs == null) return 1;
    const minutes = (now - day.lastSessionEndMs) / 60_000;
    return clamp(minutes / Math.max(1, cfg.recoveryMinutes), 0, 1);
  },

  restFactor(day, cfg, now) { return MIN_READINESS + (1 - MIN_READINESS) * this.rested(day, cfg, now); },

  reviewShares(sessionSize, newSlots) {
    let weak = SHARE_WEAK * sessionSize, shaky = SHARE_SHAKY * sessionSize;
    let good = SHARE_GOOD * sessionSize, solid = SHARE_SOLID * sessionSize;
    let owed = newSlots - SHARE_NEW * sessionSize;
    if (owed > 0) {
      const fromSolid = Math.min(owed, solid); solid -= fromSolid; owed -= fromSolid;
      const fromGood = Math.min(owed, good); good -= fromGood; owed -= fromGood;
      const fromShaky = Math.min(owed, shaky); shaky -= fromShaky; owed -= fromShaky;
      weak -= Math.min(owed, weak);
    } else if (owed < 0) {
      shaky += -owed;
    }
    const total = weak + shaky + good + solid;
    if (total <= 0) return new Map();
    return new Map([[Mastery.WEAK, weak / total], [Mastery.SHAKY, shaky / total], [Mastery.GOOD, good / total], [Mastery.SOLID, solid / total]]);
  },

  plan(progress, eligible, cfg, now, seed, day) {
    const rand = rng(seed);
    const daysLeft = this.daysUntilExam(cfg, now);
    const readiness = this.restFactor(day, cfg, now);
    const reps = (w) => progress.get(w.wordKey)?.reps ?? 0;

    const unseen = eligible.filter((w) => reps(w) === 0);
    const seen = eligible.filter((w) => reps(w) > 0);
    const requiredNewPerDay = Math.ceil(unseen.length / daysLeft);

    const remainingToday = Math.max(0, cfg.newPerDay - day.newWordsToday);
    const sittingsLeft = Math.max(1, cfg.sessionsPerDay - day.sessionsToday);
    const frontLoad = day.sessionsToday === 0 ? 1.4
      : day.sessionsToday === 1 ? 1.1
        : day.sessionsToday < cfg.sessionsPerDay ? 0.9
          : EXTRA_SITTING_NEW_SHARE;
    const allowancePart = remainingToday / sittingsLeft * frontLoad;
    const newTarget = Math.min(
      Math.ceil(allowancePart * this.restFactor(day, cfg, now)),
      remainingToday, unseen.length, Math.floor(cfg.sessionSize / 2),
    );
    const newWords = shuffled(unseen, rand).slice(0, Math.max(0, newTarget));

    const conf = new Map(eligible.map((w) => [w.wordKey, this.confidence(progress.get(w.wordKey), cfg, now)]));
    const recall = new Map(eligible.map((w) => [w.wordKey, this.recallNow(progress.get(w.wordKey), cfg, now)]));
    const mastOf = (w) => this.mastery(progress.get(w.wordKey));
    const byUrgency = (a, b) => conf.get(a.wordKey) - conf.get(b.wordKey);

    const pools = new Map();
    for (const [m, words] of groupBy(seen, mastOf)) pools.set(m, words.slice().sort(byUrgency));

    const reviewSlots = Math.max(0, cfg.sessionSize - newWords.length);
    const shares = this.reviewShares(cfg.sessionSize, newWords.length);

    const isDue = (w) => (progress.get(w.wordKey)?.dueMs ?? 0) <= now;
    const decayed = (w) => recall.get(w.wordKey) <= TOP_UP_MAX_RECALL;
    const orderedPools = new Map();
    for (const [m, words] of pools) {
      orderedPools.set(m, [
        ...words.filter(isDue),
        ...words.filter((w) => !isDue(w) && decayed(w)).sort((a, b) => recall.get(a.wordKey) - recall.get(b.wordKey)),
      ]);
    }
    const chosenAll = [...fillByShare(reviewSlots, orderedPools, shares).values()].flat();
    const dueTaken = chosenAll.filter(isDue);
    const extra = chosenAll.filter((w) => !isDue(w));

    // The sitting is always the size you set: the remainder is drawn at random, weak likeliest.
    const shortfall = reviewSlots - chosenAll.length;
    let filler = [];
    if (shortfall > 0) {
      const taken = new Set(chosenAll.map((w) => w.wordKey));
      const leftover = new Map();
      for (const [m, words] of pools) leftover.set(m, shuffled(words.filter((w) => !taken.has(w.wordKey)), rand));
      filler = weightedDraw(shortfall, leftover, rand);
    }

    const chosen = [...dueTaken, ...extra, ...filler];
    const mix = new Map();
    for (const w of chosen) { const m = mastOf(w); mix.set(m, (mix.get(m) ?? 0) + 1); }
    mix.set(Mastery.UNSEEN, newWords.length);

    const reviews = interleave(chosen.slice().sort(byUrgency));
    const queue = spreadIn(reviews, interleave(newWords));
    return {
      queue, dueCount: dueTaken.length, newCount: newWords.length, aheadCount: chosen.length - dueTaken.length,
      requiredNewPerDay, unseenCount: unseen.length, sessionNumber: day.sessionsToday + 1,
      minutesSinceLast: day.lastSessionEndMs == null ? null : Math.floor((now - day.lastSessionEndMs) / 60_000),
      readiness, mix,
    };
  },
};

function allocate(total, shares) {
  const slots = new Map();
  if (total <= 0 || shares.size === 0) { for (const k of shares.keys()) slots.set(k, 0); return slots; }
  const exact = new Map([...shares].map(([k, v]) => [k, v * total]));
  for (const [k, v] of exact) slots.set(k, Math.floor(v));
  let left = total - [...slots.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...exact].sort((a, b) => (b[1] - Math.floor(b[1])) - (a[1] - Math.floor(a[1])));
  for (const [k] of byRemainder) if (left > 0) { slots.set(k, slots.get(k) + 1); left--; }
  return slots;
}

function weightedDraw(count, pools, rand) {
  const out = [];
  while (out.length < count) {
    const open = FILL_WEIGHTS.filter(([m]) => pools.get(m)?.length);
    if (!open.length) break;
    let r = rand() * open.reduce((s, [, w]) => s + w, 0);
    let pick = open[open.length - 1][0];
    for (const [m, w] of open) { r -= w; if (r <= 0) { pick = m; break; } }
    out.push(pools.get(pick).shift());
  }
  return out;
}

function fillByShare(reviewSlots, pools, shares) {
  const taken = new Map();
  let slots = reviewSlots;
  while (slots > 0) {
    const available = [...shares.keys()].filter((m) => (pools.get(m)?.length ?? 0) > (taken.get(m)?.length ?? 0));
    if (!available.length) break;
    const sum = available.reduce((s, m) => s + shares.get(m), 0);
    if (sum <= 0) break;
    const share = allocate(slots, new Map(available.map((m) => [m, shares.get(m) / sum])));
    let added = 0;
    for (const m of available) {
      const want = share.get(m) ?? 0;
      if (want <= 0) continue;
      if (!taken.has(m)) taken.set(m, []);
      const already = taken.get(m);
      const more = (pools.get(m) ?? []).slice(already.length, already.length + want);
      already.push(...more);
      added += more.length;
    }
    if (added === 0) break;
    slots -= added;
  }
  return taken;
}

/** Neighbours share neither a deck nor a meaning family, keeping order within a deck. */
function interleave(words) {
  if (words.length <= 2) return words.map((w) => w.wordKey);
  const buckets = groupBy(words, (w) => w.deck);
  const out = [];
  let lastDeck = null, lastClusters = new Set();
  const maxBy = (entries) => entries.reduce((best, e) => (best == null || e[1].length > best[1].length ? e : best), null);
  while (buckets.size) {
    const live = [...buckets].filter(([, v]) => v.length);
    if (!live.length) break;
    const pick =
      maxBy(live.filter(([deck, v]) => deck !== lastDeck && ![...v[0].clusters].some((c) => lastClusters.has(c)))) ??
      maxBy(live.filter(([deck]) => deck !== lastDeck)) ??
      maxBy(live);
    const word = pick[1].shift();
    out.push(word.wordKey);
    lastDeck = pick[0];
    lastClusters = word.clusters;
    if (!pick[1].length) buckets.delete(pick[0]);
  }
  return out;
}

/** Distribute new words evenly through the review queue instead of front-loading them. */
function spreadIn(base, inserts) {
  if (!inserts.length) return base;
  if (!base.length) return inserts;
  const total = base.length + inserts.length;
  const stride = total / inserts.length;
  const out = [];
  let bi = 0, ii = 0, next = stride / 2;
  for (let pos = 0; pos < total; pos++) {
    if (ii < inserts.length && pos >= next) { out.push(inserts[ii++]); next += stride; }
    else if (bi < base.length) out.push(base[bi++]);
    else if (ii < inserts.length) out.push(inserts[ii++]);
  }
  return out;
}

// ---- GRE question bank -------------------------------------------------------

export const TYPE_SE = 'se';
const MARKER = /___\((i{1,3})\)___/g;
export const NUMERALS = ['i', 'ii', 'iii'];

export const correctSet = (blank) => new Set(blank.answers ?? (blank.answer != null ? [blank.answer] : []));
export const picksPerBlank = (q) => (q.type === TYPE_SE ? 2 : 1);
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
export const isCorrect = (q, sel) => sel.length === q.blanks.length && q.blanks.every((b, i) => sameSet(sel[i], correctSet(b)));
export const isComplete = (q, sel) => sel.length === q.blanks.length && sel.every((s) => s.size === picksPerBlank(q));

/** Validate the whole bank; any malformed question aborts the load with its id. */
export function parseQuestions(file) {
  const seen = new Set();
  for (const q of file.questions) {
    const fail = (reason) => { throw new Error(`question ${q.id}: ${reason}`); };
    const shape = { tc1: [1, 5], tc2: [2, 3], tc3: [3, 3], se: [1, 6] }[q.type];
    if (!q.id) fail('blank id');
    if (!shape) fail(`unknown type '${q.type}'`);
    const [blankCount, choiceCount] = shape;
    if (q.blanks.length !== blankCount) fail(`type ${q.type} needs ${blankCount} blank(s)`);
    if (!q.stem?.trim()) fail('blank stem');
    if (!q.explanation?.trim()) fail('blank explanation');
    const found = [...q.stem.matchAll(MARKER)].map((m) => m[1]).sort();
    if (found.join() !== NUMERALS.slice(0, blankCount).sort().join()) fail('stem markers do not match blanks');
    q.blanks.forEach((b, i) => {
      if (b.choices.length !== choiceCount) fail(`blank ${NUMERALS[i]} needs ${choiceCount} choices`);
      if (b.choices.some((c) => !String(c).trim())) fail(`blank ${NUMERALS[i]} has a blank choice`);
      if (new Set(b.choices).size !== b.choices.length) fail(`blank ${NUMERALS[i]} repeats a choice`);
      if (q.type === TYPE_SE ? b.answer != null : b.answers != null) fail(`blank ${NUMERALS[i]} uses the wrong answer field`);
      if (q.type === TYPE_SE) {
        if (b.answers?.length !== 2 || new Set(b.answers).size !== 2) fail(`blank ${NUMERALS[i]} needs two answers`);
        if (b.answers.some((a) => a < 0 || a >= b.choices.length)) fail('answer out of range');
      } else if (b.answer == null || b.answer < 0 || b.answer >= b.choices.length) {
        fail(`blank ${NUMERALS[i]} answer missing or out of range`);
      }
    });
    if (seen.has(q.id)) fail('duplicate id');
    seen.add(q.id);
  }
  return file.questions;
}

/**
 * Which question to show next. Passed questions are retired; unanswered ones come first;
 * once all are answered a new cycle starts; the one shown last is skipped.
 * `rows` are {id, answered, lastShownMs}.
 */
export function nextQuestion(rows, passed, rand = Math.random) {
  const live = rows.filter((r) => !passed.has(r.id));
  if (!live.length) return null;
  const unanswered = live.filter((r) => !r.answered);
  const newCycle = unanswered.length === 0;
  const pool = newCycle ? live : unanswered;
  const lastShown = rows.filter((r) => r.lastShownMs > 0).reduce((a, r) => (a == null || r.lastShownMs > a.lastShownMs ? r : a), null);
  const candidates = pool.length > 1 && lastShown ? pool.filter((r) => r.id !== lastShown.id) : pool;
  return { id: candidates[Math.floor(rand() * candidates.length)].id, newCycle };
}

export function questionTally(answers, dayStartMs, planned) {
  const results = answers.filter((a) => a.tsMs >= dayStartMs).sort((a, b) => a.tsMs - b.tsMs).map((a) => a.correct);
  planned = Math.max(0, planned);
  const extraList = results.slice(planned);
  return {
    planned, results,
    done: Math.min(planned, results.length),
    extra: extraList.length,
    extraRight: extraList.filter(Boolean).length,
    extraWrong: extraList.filter((x) => !x).length,
    planComplete: results.length >= planned,
  };
}

// ---- meaning map ----------------------------------------------------------------

export function buildClusters(file) {
  const axes = file?.axes ?? [];
  const groups = file?.groups ?? [];
  const axesOf = new Map();
  for (const axis of axes) for (const m of axis.words) {
    if (!axesOf.has(m.w)) axesOf.set(m.w, new Set());
    axesOf.get(m.w).add(axis.id);
  }
  const groupsOf = new Map();
  for (const g of groups) for (const w of g.w) {
    if (!groupsOf.has(w)) groupsOf.set(w, []);
    groupsOf.get(w).push(g);
  }
  return {
    axes, axesOf, byId: new Map(axes.map((a) => [a.id, a])),
    neighboursOf(key, limit = 3) {
      const mine = groupsOf.get(key) ?? [];
      if (!mine.length) return { synonyms: [], opposite: null, sense: '' };
      const synonyms = [...new Set(mine.flatMap((g) => g.w).filter((w) => w !== key))].slice(0, limit);
      const opposite = mine.map((g) => g.o?.[0]).find((x) => x != null) ?? null;
      return { synonyms, opposite, sense: mine[0].sense };
    },
  };
}

export const labelFor = (axis, p) => (p === 0 ? 'in between' : p < 0 ? axis.left : axis.right);
