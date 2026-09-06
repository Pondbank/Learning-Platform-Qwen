/**
 * ============================================================
 * LearnJoy v2.0.0 — Bite-sized AI Learning
 * ============================================================
 * Single-page frontend for the LearnJoy Google Apps Script API.
 *
 * New in v2 (vs. the original codebase):
 *  - One consistent app (the old repo had two conflicting apps:
 *    an inline <script> in index.html and an app.js that
 *    referenced ~30 DOM ids that didn't exist).
 *  - API client with timeouts, retries for idempotent calls and
 *    friendly error messages.
 *  - Full DEMO MODE (offline mock backend) — works with zero setup.
 *  - Offline cache + reconnect banner, hash routing, a11y, XP,
 *    sounds, confetti, flashcards, quiz timer, command palette,
 *    settings, shortcuts, notes autosave, and much more.
 * ============================================================
 */

(function () {
  'use strict';

  /* ==========================================================
     0. CONFIG & CONSTANTS
     ========================================================== */
  const APP_VERSION = '2.1.0';
  const CFG = window.APP_CONFIG || {};
  const API_URL = String(CFG.API_URL || '').trim();
  const DEMO_ONLY = !API_URL || /(^|\/)demo$/i.test(API_URL) || API_URL.indexOf('PASTE_YOUR') !== -1;

  const SLOW_ACTIONS = new Set(['generateCourse', 'generateLesson', 'generateQuiz', 'generateReview', 'askTutor']);
  const RETRYABLE = new Set(['getConfig', 'getDashboard', 'getCourseById', 'getNotes']);

  // Mirrors ACHIEVEMENT_DEFS_ in the Apps Script backend, so the dashboard can
  // show the full collection with locked/unlocked states.
  const ACH_DEFS = {
    first_lesson: { name: 'First Lesson', description: 'Completed your first lesson', icon: '🎯' },
    week_streak: { name: 'Week Streak', description: 'Reached a 7-day streak', icon: '🔥' },
    perfect_quiz: { name: 'Perfect Quiz', description: 'Scored 100% on a quiz', icon: '⭐' },
    course_complete: { name: 'Course Complete', description: 'Finished an entire course', icon: '🏆' },
    quiz_master: { name: 'Quiz Master', description: 'Completed 10 quizzes', icon: '📝' },
    lesson_lover: { name: 'Lesson Lover', description: 'Completed 25 lessons', icon: '📚' },
    consistent_learner: { name: 'Consistent Learner', description: 'Reached a 30-day streak', icon: '💪' }
  };

  /* ==========================================================
     1. UTILITIES
     ========================================================== */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const textHtml = (v) => esc(v).replace(/\n/g, '<br>');
  const emptyBox = (text) => `<div class="empty">${esc(text)}</div>`;

  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function relTime(s) {
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const h = Math.floor(min / 60);
    if (h < 24) return h + 'h ago';
    const days = Math.floor(h / 24);
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fmtClock(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  const todayKey = () => new Date().toISOString().slice(0, 10);

  function uid() {
    return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function hashStr(s) {
    let h = 5381;
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rngFor = (key) => mulberry32(hashStr(key));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  function shuffled(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { /* noop */ }
      document.body.removeChild(ta);
      return ok;
    }
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /* ---------- storage ---------- */
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* full/blocked */ } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* noop */ } }
  function jsonGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function jsonSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* noop */ } }

  /* ==========================================================
     2. SETTINGS
     ========================================================== */
  const SETTINGS_KEY = 'lj_settings_v2';
  let settings = Object.assign({ sound: true, animations: true, bigFont: false, dailyGoal: 3, themeMode: 'manual' }, jsonGet(SETTINGS_KEY, {}));

  function saveSettings() { jsonSet(SETTINGS_KEY, settings); }

  function applySettings() {
    const html = document.documentElement;
    html.classList.toggle('no-anim', !settings.animations);
    html.classList.toggle('big-font', !!settings.bigFont);
    if ($('set-sound')) $('set-sound').checked = !!settings.sound;
    if ($('set-animations')) $('set-animations').checked = !!settings.animations;
    if ($('set-bigfont')) $('set-bigfont').checked = !!settings.bigFont;
  }

  /* ==========================================================
     3. SOUND ENGINE (WebAudio, no assets)
     ========================================================== */
  let audioCtx = null;

  function tone(freq, start, dur, type, vol) {
    const t0 = audioCtx.currentTime + start;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function sound(name) {
    if (!settings.sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      switch (name) {
        case 'correct': tone(660, 0, 0.12, 'sine'); tone(880, 0.09, 0.16, 'sine'); break;
        case 'wrong': tone(220, 0, 0.2, 'square', 0.06); tone(180, 0.12, 0.22, 'square', 0.05); break;
        case 'complete': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.18, 'triangle')); break;
        case 'flip': tone(440, 0, 0.06, 'triangle', 0.06); break;
        case 'xp': tone(988, 0, 0.08, 'sine', 0.08); tone(1319, 0.07, 0.12, 'sine', 0.08); break;
        case 'click': tone(520, 0, 0.04, 'triangle', 0.05); break;
        default: break;
      }
    } catch (e) { /* audio unavailable */ }
  }

  /* ==========================================================
     4. CONFETTI
     ========================================================== */
  function confettiBurst(count) {
    if (!settings.animations) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = $('confetti-canvas');
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ['#58cc02', '#8cf20b', '#ffd800', '#38bdf8', '#a855f7', '#ffffff'];
    const parts = [];
    const n = count || 130;
    for (let i = 0; i < n; i++) {
      parts.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.5,
        y: canvas.height * 0.35,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 13 - 4,
        g: 0.35,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        life: 120 + Math.random() * 40
      });
    }
    let frames = 0;
    (function tick() {
      frames++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      parts.forEach((p) => {
        if (p.life <= 0) return;
        alive = true;
        p.life--; p.x += p.vx; p.y += p.vy; p.vy += p.g; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = clamp(p.life / 40, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      if (alive && frames < 240) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    })();
  }

  /* ==========================================================
     5. TOASTS
     ========================================================== */
  function showToast(message, type, ms) {
    const wrap = $('toasts');
    const icons = { error: '⚠️ ', success: '✅ ', info: '' };
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = (icons[type] || '') + message;
    wrap.appendChild(t);
    while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
    setTimeout(() => {
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 300);
    }, ms || 4200);
  }

  /* ==========================================================
     6. LOADING OVERLAY
     ========================================================== */
  let loadingShowTimer = null;
  let loadingTipTimer = null;
  let loadingTipInterval = null;
  let loadingProgressInterval = null;

  function showLoading(text, opts) {
    opts = opts || {};
    clearTimeout(loadingShowTimer);
    clearTimeout(loadingTipTimer);
    clearInterval(loadingTipInterval);
    clearInterval(loadingProgressInterval);

    $('loading-text').textContent = text || 'Loading…';
    $('loading-sub').textContent = opts.sub || '';
    $('loading-tip').textContent = '';

    const fill = $('loading-fill');
    fill.classList.remove('indeterminate');
    fill.style.width = '0%';

    loadingShowTimer = setTimeout(() => {
      $('loading').classList.add('show');
      $('loading').setAttribute('aria-hidden', 'false');
      document.body.classList.add('busy');
    }, 160);

    if (opts.progress) {
      let pct = 6;
      fill.style.width = pct + '%';
      loadingProgressInterval = setInterval(() => {
        if (pct < 82) pct += Math.random() * 9 + 3;
        else if (pct < 94) pct += Math.random() * 1.5 + 0.3;
        fill.style.width = Math.min(95, Math.floor(pct)) + '%';
      }, 600);
    } else {
      fill.classList.add('indeterminate');
    }

    loadingTipTimer = setTimeout(() => {
      const tips = opts.tips && opts.tips.length ? opts.tips : ['Almost there…'];
      let i = 0;
      $('loading-tip').textContent = tips[0];
      loadingTipInterval = setInterval(() => {
        i = (i + 1) % tips.length;
        $('loading-tip').textContent = tips[i];
      }, 1500);
    }, 1000);
  }

  function hideLoading() {
    clearTimeout(loadingShowTimer);
    clearTimeout(loadingTipTimer);
    clearInterval(loadingTipInterval);

    const finish = () => {
      $('loading').classList.remove('show');
      $('loading').setAttribute('aria-hidden', 'true');
      document.body.classList.remove('busy');
    };

    if (loadingProgressInterval) {
      clearInterval(loadingProgressInterval);
      loadingProgressInterval = null;
      $('loading-fill').classList.remove('indeterminate');
      $('loading-fill').style.width = '100%';
      setTimeout(finish, 200);
    } else {
      finish();
    }
  }

  /* ==========================================================
     7. MODALS
     ========================================================== */
  let lastFocused = null;

  function openModal(id) {
    const m = $(id);
    if (!m) return;
    lastFocused = document.activeElement;
    m.classList.remove('hidden');
    document.body.classList.add('modal-open');
    const focusable = m.querySelector('input, button, [tabindex]');
    if (focusable) setTimeout(() => focusable.focus(), 40);
  }

  function closeModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.add('hidden');
    if (!$$('.modal-overlay:not(.hidden)').length) document.body.classList.remove('modal-open');
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function closeTopModal() {
    const open = $$('.modal-overlay:not(.hidden)');
    if (!open.length) return false;
    closeModal(open[open.length - 1].id);
    return true;
  }

  function confirmDialog(opts) {
    opts = opts || {};
    $('confirm-title').textContent = opts.title || 'Are you sure?';
    $('confirm-text').textContent = opts.text || '';
    const ok = $('btn-confirm-ok');
    ok.textContent = opts.okLabel || 'Confirm';
    ok.className = 'btn grow ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    openModal('modal-confirm');
    return new Promise((resolve) => {
      const done = (val) => {
        ok.onclick = null;
        $('btn-confirm-cancel').onclick = null;
        closeModal('modal-confirm');
        resolve(val);
      };
      ok.onclick = () => done(true);
      $('btn-confirm-cancel').onclick = () => done(false);
    });
  }

  /* ==========================================================
     8. API CLIENT (real backend)
     ========================================================== */
  class ApiError extends Error { }

  async function api(action, params, opts) {
    opts = opts || {};
    if (Demo.active()) {
      const token = opts.noAuth ? '' : (lsGet('lj_token') || '');
      return Demo.api(action, Object.assign({}, params, { token }), opts);
    }

    if (!API_URL || API_URL.indexOf('PASTE_YOUR') !== -1) {
      throw new ApiError('No backend configured. Set APP_CONFIG.API_URL in index.html, or use demo mode.');
    }

    const token = opts.noAuth ? '' : (lsGet('lj_token') || '');
    const timeoutMs = opts.timeout || (SLOW_ACTIONS.has(action) ? 150000 : 30000);
    const attempts = RETRYABLE.has(action) ? 2 : 1;
    let lastErr = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action, params: params || {}, token }),
          signal: ctrl.signal
        });
        clearTimeout(timer);
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          console.error('Unexpected API response:', text && text.slice(0, 300));
          throw new ApiError('Backend returned an unexpected response. Check API_URL ends with /exec and access = Anyone.');
        }
        if (!data || data.success === false) {
          throw new ApiError((data && data.error) || 'Request failed');
        }
        return data;
      } catch (err) {
        clearTimeout(timer);
        const isNetworkErr = err && (err instanceof TypeError || err.name === 'TypeError');
        if (err && err.name === 'AbortError') {
          lastErr = new ApiError('That took too long — the request timed out. Please try again.');
        } else if (isNetworkErr) {
          lastErr = new ApiError('Cannot reach the backend. Check your connection and that API_URL ends with /exec.');
        } else {
          lastErr = err;
        }
        if (attempt < attempts && (err && (err.name === 'AbortError' || isNetworkErr))) {
          await sleep(700);
          continue;
        }
        throw lastErr;
      }
    }
    throw lastErr || new ApiError('Request failed');
  }

  /* ==========================================================
     9. DEMO BACKEND — a complete offline mock of the API,
        so LearnJoy works instantly with zero configuration.
     ========================================================== */
  const Demo = (() => {
    const DB_KEY = 'lj_demo_db_v1';
    let db = jsonGet(DB_KEY, null) || { users: {}, sessions: {}, seq: 1 };
    const save = () => jsonSet(DB_KEY, db);

    const active = () => lsGet('lj_demo') === '1';
    const enable = () => lsSet('lj_demo', '1');
    const disable = () => lsDel('lj_demo');
    const reset = () => { db = { users: {}, sessions: {}, seq: 1 }; save(); };

    /* ---------- content banks ---------- */
    const MODULE_TITLES = (T) => [
      `Getting Started with ${T}`,
      `Core Skills in ${T}`,
      `${T}: Level Up`
    ];
    const LESSON_TITLES = (T) => [
      [`What is ${T} and why it matters`, `The essential vocabulary of ${T}`, `How ${T} works: the big picture`],
      [`${T} fundamentals, step by step`, `Patterns and tricks beginners miss`, `Your first hands-on ${T} exercise`],
      [`Common ${T} mistakes (and fixes)`, `Building a ${T} practice habit`, `Your next steps in ${T}`]
    ];
    const FALSE_STATEMENTS = (T) => [
      `${T} is only useful for professionals.`,
      `You must study ${T} for hours every day to make progress.`,
      `Beginners should avoid practicing ${T} until they know everything.`
    ];
    const GOOD_HABITS = [
      'Practicing a little bit every day',
      'Reviewing what you learned yesterday',
      'Asking questions when you are confused'
    ];
    const ADVICE = [
      'Practice in short daily sessions instead of one long cram',
      'Test yourself with quizzes instead of only re-reading',
      'Explain the idea out loud in your own words',
      'Connect new ideas to things you already know'
    ];
    const BAD_ADVICE = [
      'Skip all practice and hope for the best',
      'Only read about it once, never review',
      'Memorize everything without understanding',
      'Wait until you feel 100% ready before trying'
    ];

    /* ---------- deterministic content generation ---------- */
    function keyPointsFor(T, lt, rng) {
      return [
        `${lt} is one of the building blocks of ${T} — understanding it makes everything else easier.`,
        `In ${T}, small consistent practice beats rare big efforts: 10 focused minutes a day compounds fast.`,
        `The fastest way to learn ${lt} is to try it, make mistakes, and fix them one by one.`
      ];
    }

    function lessonContent(courseId, mi, li, topic, level) {
      const T = topic;
      const lt = LESSON_TITLES(T)[mi][li];
      const lessonId = `${courseId}_m${mi}_l${li}`;
      const rng = rngFor(lessonId);
      const keyPoints = keyPointsFor(T, lt, rng);
      return {
        lessonId,
        estimatedMinutes: 5 + Math.floor(rng() * 5),
        introduction:
          `Welcome! In this bite-sized lesson you'll get a clear tour of “${lt}”. ` +
          `No fluff — just the core idea, a couple of examples, and one thing to watch out for. ` +
          (level === 'Beginner' ? 'Everything is explained from scratch.' :
            level === 'Advanced' ? 'We assume you know the basics and go straight to substance.' :
              'We build on the fundamentals you already have.'),
        keyPoints,
        examples: [
          `Imagine you have 10 minutes before your coffee breaks. You pick one small piece of “${lt}”, try it once, note what confused you, and look that one thing up. That loop — try, notice, fix — is exactly how people get good at ${T}.`,
          `A learner we'll call Sam spent one week doing a 5-minute exercise on “${lt}” every morning. By day seven, Sam could explain it to a friend without notes. Short, repeated, active practice did the job.`
        ],
        commonMistakes: [
          `Trying to memorize ${lt} word-for-word instead of understanding the idea — recognition is not the same as recall.`,
          `Skipping the examples because they “look easy”. Easy-looking examples are where the quiet details hide.`
        ],
        summary:
          `Quick recap: “${lt}” matters because it underpins ${T}; practice it in small daily bites; ` +
          `test yourself instead of re-reading; and watch out for passive memorization. Next lesson builds directly on this one.`,
        exercise: {
          prompt: `Take 2 minutes: without looking back at the slides, write down (or say out loud) the single most important idea from “${lt}”, plus one question you still have about ${T}.`,
          hint: `Start from the key points — which one would you tell a friend first?`,
          solution: `A strong answer names the core idea of “${lt}” in your own words and connects it to why ${T} matters. Bonus points if your question is specific (“when does X not apply?” beats “any more info?”).`
        }
      };
    }

    function quizFor(courseId, lessonId) {
      const m = String(lessonId).match(/_m(\d+)_l(\d+)$/);
      const mi = m ? Number(m[1]) : 0;
      const li = m ? Number(m[2]) : 0;
      const course = findCourseByLesson(lessonId);
      const topic = course ? course.topic : 'this topic';
      const level = course ? course.level : 'Beginner';
      const T = topic;
      const lt = LESSON_TITLES(T)[mi] ? LESSON_TITLES(T)[mi][li] : 'this lesson';
      const c = lessonContent(courseId, mi, li, T, level);
      const rng = rngFor(lessonId + ':quiz');

      const kp = c.keyPoints;
      const questions = [];

      // Like the real backend: exactly 5 questions — 2 mc, 1 tf, 2 short, ids q1..q5.

      // MC 1 — core idea
      const q1opts = shuffled(rng, [kp[0], pick(rng, [
        `${T} cannot be learned in small steps.`,
        `${T} only applies to advanced experts.`,
        `${T} requires expensive tools before you can start.`
      ]), pick(rng, BAD_ADVICE) + '.', `${lt} is outdated and rarely used today.`]);
      questions.push({
        id: 'q1', type: 'mc',
        prompt: `Which statement about "${lt}" is true?`,
        options: q1opts, answer: kp[0],
        explanation: 'The core idea of the lesson — understanding beats memorization, and small steps work.'
      });

      // MC 2 — common mistakes
      const q2opts = shuffled(rng, [c.commonMistakes[0], GOOD_HABITS[0], GOOD_HABITS[1], GOOD_HABITS[2]]);
      questions.push({
        id: 'q2', type: 'mc',
        prompt: 'Which of these is a common mistake learners make?',
        options: q2opts, answer: c.commonMistakes[0],
        explanation: 'Memorizing word-for-word without understanding is the trap we warned about.'
      });

      // TF
      const tfFalse = rng() < 0.5;
      questions.push(tfFalse ? {
        id: 'q3', type: 'tf',
        prompt: pick(rng, FALSE_STATEMENTS(T)),
        answer: false,
        explanation: `${T} rewards small, consistent, beginner-friendly practice — the opposite of that statement.`
      } : {
        id: 'q3', type: 'tf',
        prompt: kp[1],
        answer: true,
        explanation: 'Consistency is the theme of this lesson.'
      });

      // Short 1 — cloze from a key point
      const words = kp[2].replace(/[.,!?;:"()]/g, '').split(' ');
      let target = words.reduce((a, b) => (b.length > a.length ? b : a), 'practice');
      if (target.length < 4) target = 'practice';
      const escRe = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cloze = kp[2].replace(new RegExp(escRe, 'i'), '_____');
      questions.push({
        id: 'q4', type: 'short',
        prompt: `Fill in the blank (one word): ${cloze}`,
        answer: `${target}|practice`,
        explanation: `The missing word is "${target}".`
      });

      // Short 2 — recall
      questions.push({
        id: 'q5', type: 'short',
        prompt: `In your own words, why does "${lt}" matter for learning ${T}?`,
        answer: `${target}|building block|foundation|understanding|basics|fundamentals`,
        explanation: 'Any answer that captures the idea that this lesson is a building block works.'
      });

      return { quizId: lessonId + ':quiz', questions };
    }

    /* ---------- db helpers ---------- */
    function findCourse(user, courseId) {
      return (user.courses || []).find((c) => c.courseId === courseId) || null;
    }
    let _lastCourseCache = null;
    function findCourseByLesson(lessonId) {
      return _lastCourseCache;
    }

    function progressOf(course) {
      let total = 0, done = 0;
      (course.modules || []).forEach((m) => m.lessons.forEach((l) => { total++; if (l.completed) done++; }));
      return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
    }

    function publicCourse(course) {
      const p = progressOf(course);
      const completedKeys = [];
      course.modules.forEach((m, mi) => m.lessons.forEach((l, li) => {
        if (l.completed) completedKeys.push(`${course.courseId}_m${mi}_l${li}`);
      }));
      return {
        courseId: course.courseId,
        title: course.title,
        description: course.description,
        level: course.level,
        timeAvailable: course.timeAvailable,
        learningStyle: course.learningStyle,
        estimatedHours: course.estimatedHours,
        completedCount: p.done,
        completedKeys,
        totalLessons: p.total,
        progressPercent: p.pct,
        modules: course.modules.map((m, mi) => ({
          title: m.title,
          moduleIndex: mi,
          lessons: m.lessons.map((l, li) => ({
            lessonId: `${course.courseId}_m${mi}_l${li}`,
            lessonIndex: li, title: l.title, summary: l.summary, completed: !!l.completed
          }))
        }))
      };
    }

    function buildCourse(topic, level, timeAvailable, learningStyle) {
      const id = 'c' + (db.seq++);
      const titles = MODULE_TITLES(topic);
      const lessons = LESSON_TITLES(topic);
      const course = {
        courseId: id,
        topic, level, timeAvailable, learningStyle,
        title: `${topic} (${level})`,
        description:
          `A bite-sized course on ${topic}, tuned for ${String(timeAvailable).toLowerCase()} ` +
          `with a ${String(learningStyle).toLowerCase()} learning style. Every lesson is short, ` +
          `ends with a practice exercise, and has a quiz plus flashcards.`,
        estimatedHours: level === 'Beginner' ? 2 : level === 'Intermediate' ? 3 : 4,
        createdAt: new Date().toISOString(),
        modules: titles.map((t, mi) => ({
          title: t,
          lessons: lessons[mi].map((lt, li) => ({
            title: lt,
            summary: lessonContent(id, mi, li, topic, level).introduction.slice(0, 90) + '…',
            completed: false
          }))
        }))
      };
      return course;
    }

    function touchStreak(user) {
      const today = todayKey();
      if (user.lastDay === today) return user.streak || 1;
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      user.streak = (user.lastDay === yesterday) ? (user.streak || 0) + 1 : 1;
      user.lastDay = today;
      return user.streak;
    }

    // Mirrors the backend's ACHIEVEMENT_DEFS_ so demo and production look identical.
    function achievementsFor(user) {
      const earned = [];
      const push = (type, meta) => earned.push(Object.assign({ type, earnedAt: user.lastDay ? user.lastDay + 'T12:00:00.000Z' : new Date().toISOString() }, ACH_DEFS[type], meta || {}));
      if ((user.lessonsCompleted || 0) >= 1) push('first_lesson');
      if ((user.bestStreak || 0) >= 7) push('week_streak');
      if ((user.bestStreak || 0) >= 30) push('consistent_learner');
      if (user.gotPerfect) push('perfect_quiz');
      if ((user.coursesCompleted || 0) >= 1) push('course_complete');
      if ((user.quizzesTaken || 0) >= 10) push('quiz_master');
      if ((user.lessonsCompleted || 0) >= 25) push('lesson_lover');
      return earned;
    }

    /* ---------- dispatch ---------- */
    async function apiCall(action, params) {
      params = params || {};
      const latency = SLOW_ACTIONS.has(action) ? 900 + Math.random() * 900 : 240 + Math.random() * 420;
      await sleep(latency);

      const user = params.token ? db.users[db.sessions[params.token] || ''] : null;
      const needAuth = () => {
        if (!user) { const e = new Error('Session expired — please sign in again.'); e.code = 'AUTH'; throw e; }
        return user;
      };

      switch (action) {
        case 'getConfig':
          return { allowRegister: true, demo: true };

        case 'register':
        case 'login': {
          const username = String(params.username || '').trim().toLowerCase();
          const password = String(params.password || '');
          // Same rules as the production backend:
          if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Invalid username or password');
          if (password.length < 8) throw new Error('Passwords need at least 8 characters.');
          const key = username;
          if (action === 'register') {
            if (db.users[key]) throw new Error('Invalid username or password');
            db.users[key] = {
              username, name: username, pw: String(hashStr(password)),
              createdAt: new Date().toISOString(),
              lessonsCompleted: 0, quizzesTaken: 0, coursesCompleted: 0,
              notesSaved: 0, decksDone: 0, streak: 0, bestStreak: 0, lastDay: null,
              gotPerfect: false, courses: [], scores: [], notes: {}, flags: {}
            };
            seedStarterCourse(db.users[key]);
          } else {
            const u = db.users[key];
            if (!u) throw new Error('Invalid username or password');
            if (u.pw !== String(hashStr(password))) throw new Error('Invalid username or password');
          }
          const u = db.users[key];
          const token = 'demo_' + uid();
          db.sessions[token] = key;
          save();
          return { session: { token }, user: { username: u.username, name: u.name, streak: u.streak || 0, lastActiveDate: u.lastDay || '' } };
        }

        case 'demoLogin': {
          const name = (params.username || 'explorer').trim() || 'explorer';
          const key = name.toLowerCase();
          if (!db.users[key]) {
            db.users[key] = {
              username: name, name, pw: String(hashStr('demo')),
              createdAt: new Date().toISOString(),
              lessonsCompleted: 0, quizzesTaken: 0, coursesCompleted: 0,
              notesSaved: 0, decksDone: 0, streak: 0, bestStreak: 0, lastDay: null,
              gotPerfect: false, courses: [], scores: [], notes: {}, flags: {}
            };
            seedStarterCourse(db.users[key]);
          }
          const token = 'demo_' + uid();
          db.sessions[token] = key;
          save();
          return { session: { token }, user: { username: db.users[key].username, name: db.users[key].name, streak: db.users[key].streak || 0 } };
        }

        case 'logout':
          if (params.token) delete db.sessions[params.token];
          save();
          return {};

        case 'getDashboard': {
          const u = needAuth();
          _lastCourseCache = null;
          const scores = (u.scores || []).slice(0, 20);
          const avg = scores.length ? Math.round(scores.reduce((a, s) => a + s.score, 0) / scores.length) : 0;
          const cont = (u.courses || []).find((c) => progressOf(c).pct < 100) || u.courses[u.courses.length - 1];
          return {
            user: { username: u.username, name: u.name, streak: u.streak || 0, lastActiveDate: u.lastDay || '' },
            streak: u.streak || 0,
            completedLessons: u.lessonsCompleted || 0,
            averageScore: avg,
            courses: (u.courses || []).map(publicCourse),
            continueCourseId: cont ? cont.courseId : '',
            recentScores: scores,
            achievements: achievementsFor(u)
          };
        }

        case 'generateCourse': {
          const u = needAuth();
          const topic = String(params.prompt || '').trim();
          if (topic.length < 3) throw new Error('Please describe what you want to learn.');
          const course = buildCourse(topic, params.level || 'Beginner', params.timeAvailable || '10 minutes per day', params.learningStyle || 'Balanced');
          u.courses.push(course);
          save();
          return { course: { courseId: course.courseId } };
        }

        case 'getCourseById': {
          const u = needAuth();
          const course = findCourse(u, params.courseId);
          if (!course) throw new Error('Course not found.');
          _lastCourseCache = course;
          return { course: publicCourse(course) };
        }

        case 'generateLesson': {
          const u = needAuth();
          const course = findCourse(u, params.courseId);
          if (!course) throw new Error('Course not found.');
          _lastCourseCache = course;
          // Accept either explicit indices or a lessonId (like the backend's getLessonById).
          let mi = Number(params.moduleIndex), li = Number(params.lessonIndex);
          if (params.lessonId) {
            const m = String(params.lessonId).match(/_m(\d+)_l(\d+)$/);
            if (m) { mi = Number(m[1]); li = Number(m[2]); }
          }
          if (!(mi >= 0) || !(li >= 0) || !course.modules[mi] || !course.modules[mi].lessons[li]) {
            throw new Error('Lesson not found');
          }
          const lesson = lessonContent(course.courseId, mi, li, course.topic, course.level);
          const stored = course.modules[mi].lessons[li];
          return {
            lesson: {
              lessonId: lesson.lessonId,
              courseId: course.courseId,
              lessonTitle: stored ? stored.title : 'Lesson',
              moduleTitle: course.modules[mi].title,
              completed: !!(stored && stored.completed),
              content: lesson
            }
          };
        }

        case 'markLessonComplete': {
          const u = needAuth();
          const course = findCourse(u, params.courseId);
          if (!course) throw new Error('Course not found.');
          const mm = String(params.lessonId || '').match(/_m(\d+)_l(\d+)$/);
          const found = mm && course.modules[Number(mm[1])] ? course.modules[Number(mm[1])].lessons[Number(mm[2])] : null;
          if (found && !found.completed) {
            found.completed = true;
            u.lessonsCompleted = (u.lessonsCompleted || 0) + 1;
          }
          const streak = touchStreak(u);
          u.bestStreak = Math.max(u.bestStreak || 0, streak);
          const p = progressOf(course);
          const courseCompleted = p.total > 0 && p.done === p.total;
          if (courseCompleted && !course.countedDone) {
            course.countedDone = true;
            u.coursesCompleted = (u.coursesCompleted || 0) + 1;
          }
          save();
          return { completed: true, previouslyCompleted: !!found && found.completed, streak, totalLessons: u.lessonsCompleted, courseCompleted };
        }

        case 'getNotes': {
          const u = needAuth();
          const all = Object.keys(u.notes).map((lessonId) => ({
            noteId: 'n_' + hashStr(lessonId).toString(36),
            lessonId,
            content: u.notes[lessonId].content,
            updatedAt: u.notes[lessonId].updatedAt
          }));
          return { notes: params.lessonId ? all.filter((n) => n.lessonId === params.lessonId) : all };
        }

        case 'saveNote': {
          const u = needAuth();
          u.notes[params.lessonId] = { content: String(params.content || ''), updatedAt: new Date().toISOString() };
          u.notesSaved = (u.notesSaved || 0) + 1;
          save();
          return {};
        }

        case 'askTutor': {
          const u = needAuth();
          const course = (u.courses || []).find((c) => lessonIdMatchesCourse(params.lessonId, c));
          if (!course) return { answer: 'I could not find that lesson, but here is a tip: explain the idea out loud in your own words — it exposes gaps instantly.' };
          const m = params.lessonId.match(/_m(\d+)_l(\d+)$/);
          const mi = m ? Number(m[1]) : 0, li = m ? Number(m[2]) : 0;
          const c = lessonContent(course.courseId, mi, li, course.topic, course.level);
          const rng = rngFor(params.lessonId + (params.question || '') + Date.now());
          const openers = ['Great question!', 'Nice — let’s keep it simple.', 'Here’s the short version:', 'Love the curiosity!'];
          return {
            answer:
              `${pick(rng, openers)} About “${(course.modules[mi] || { lessons: [{}] }).lessons?.[li]?.title || 'this lesson'}”:\n\n` +
              `• ${c.keyPoints[0]}\n• ${c.keyPoints[2]}\n\n` +
              `Try this: ${c.exercise.prompt}\n\nWant it even shorter? Remember: small daily practice > one big cram.`
          };
        }

        case 'generateQuiz': {
          const u = needAuth();
          const course = (u.courses || []).find((c) => lessonIdMatchesCourse(params.lessonId, c));
          if (!course) throw new Error('Lesson not found.');
          _lastCourseCache = course;
          return { quiz: quizFor(course.courseId, params.lessonId) };
        }

        case 'submitQuiz': {
          const u = needAuth();
          const course = (u.courses || []).find((c) => lessonIdMatchesCourse(params.lessonId, c));
          if (!course) throw new Error('Lesson not found.');
          _lastCourseCache = course;
          const quiz = quizFor(course.courseId, params.lessonId);
          const byId = {};
          quiz.questions.forEach((q) => { byId[q.id] = q; });
          let correct = 0;
          const results = (params.answers || []).map((a) => {
            const q = byId[a.questionId];
            if (!q) return { prompt: '?', userAnswer: a.answer, correctAnswer: '', correct: false };
            const g = gradeQuestionLocal(q, a.answer);
            if (g.correct) correct++;
            return { prompt: q.prompt, userAnswer: g.userAnswer, correctAnswer: g.correctAnswer, correct: g.correct };
          });
          const total = quiz.questions.length;
          const score = total ? Math.round((correct / total) * 100) : 0;
          u.quizzesTaken = (u.quizzesTaken || 0) + 1;
          if (score === 100) u.gotPerfect = true;
          const lessonTitle = lessonTitleFor(course, params.lessonId);
          u.scores.unshift({
            createdAt: new Date().toISOString(),
            courseTitle: course.title,
            lessonTitle,
            score
          });
          u.scores = u.scores.slice(0, 20);
          touchStreak(u);
          save();
          return { score, correct, total, results };
        }

        case 'generateReview': {
          const u = needAuth();
          const course = (u.courses || []).find((c) => lessonIdMatchesCourse(params.lessonId, c));
          if (!course) throw new Error('Lesson not found.');
          const m = params.lessonId.match(/_m(\d+)_l(\d+)$/);
          const mi = m ? Number(m[1]) : 0, li = m ? Number(m[2]) : 0;
          const c = lessonContent(course.courseId, mi, li, course.topic, course.level);
          return {
            review: {
              simplifiedExplanation:
                `Think of it like learning to ride a bike: you don't memorize physics — you try, wobble, and adjust. ` +
                `${c.keyPoints[2]}`,
              reviewLesson:
                `1. ${c.keyPoints[0]}\n2. ${c.keyPoints[1]}\n3. Watch out: ${c.commonMistakes[0]}`,
              practiceQuestions: [
                { prompt: `In one sentence, why does “${(course.modules[mi] || { lessons: [{}] }).lessons?.[li]?.title || 'this lesson'}” matter?`, answer: c.keyPoints[0], explanation: 'This is the anchor idea of the lesson.' },
                { prompt: 'What daily habit makes learning stick best?', answer: 'Short, consistent practice sessions every day', explanation: c.keyPoints[1] },
                { prompt: 'Name one mistake to avoid.', answer: c.commonMistakes[0], explanation: 'Recognizing the trap is half the fix.' }
              ]
            }
          };
        }

        default:
          throw new Error(`Demo mode doesn't support "${action}".`);
      }
    }

    function lessonIdMatchesCourse(lessonId, course) {
      return String(lessonId || '').indexOf(course.courseId + '_') === 0;
    }
    function lessonTitleFor(course, lessonId) {
      const m = String(lessonId).match(/_m(\d+)_l(\d+)$/);
      if (!m) return 'Lesson';
      const mod = course.modules[Number(m[1])];
      return mod && mod.lessons[Number(m[2])] ? mod.lessons[Number(m[2])].title : 'Lesson';
    }

    function seedStarterCourse(user) {
      const T = 'Learning how to learn';
      const course = buildCourse(T, 'Beginner', '10 minutes per day', 'Balanced');
      course.title = 'Welcome to LearnJoy 🌱';
      course.description = 'Your starter course: how LearnJoy works and how to learn anything bite by bite. Complete a lesson, try the quiz, flip some flashcards!';
      user.courses.push(course);
    }

    return { active, enable, disable, reset, api: apiCall };
  })();

  /* ==========================================================
     10. OFFLINE HANDLING & CACHE
     ========================================================== */
  const CACHE_PREFIX = 'lj_cache_';

  function cacheSet(key, value) { jsonSet(CACHE_PREFIX + key, { ts: Date.now(), value }); }
  function cacheGet(key) {
    const e = jsonGet(CACHE_PREFIX + key, null);
    return e ? e.value : null;
  }
  function clearCache() {
    const kill = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) kill.push(k);
      }
    } catch (e) { /* noop */ }
    kill.forEach((k) => lsDel(k));
  }

  function updateNetPill() {
    const pill = $('net-pill');
    if (navigator.onLine) {
      pill.textContent = '🟢 Online';
      pill.classList.remove('offline');
      $('offline-banner').classList.add('hidden');
    } else {
      pill.textContent = '🟠 Offline';
      pill.classList.add('offline');
      $('offline-banner').classList.remove('hidden');
    }
  }

  window.addEventListener('online', () => {
    updateNetPill();
    showToast('Back online!', 'success');
    if (currentView() === 'dashboard' && isAuthed()) refreshDashboard();
  });
  window.addEventListener('offline', updateNetPill);

  /* ==========================================================
     11. XP, LEVELS & TIME TRACKING
     ========================================================== */
  const XP_KEY = 'lj_xp_v2';
  const TIME_KEY = 'lj_time_v2';
  const BEST_KEY = 'lj_best_v2';
  const LASTQUIZ_KEY = 'lj_lastquiz_v2';
  const DAILYDONE_KEY = 'lj_dailydone_v2';
  const TITLES_KEY = 'lj_lesson_titles_v2';

  const xpGet = () => jsonGet(XP_KEY, 0);
  const levelFor = (xp) => Math.floor(xp / 100) + 1;
  const levelProgress = (xp) => xp % 100;

  function addXp(amount, reason) {
    const before = xpGet();
    const after = before + amount;
    jsonSet(XP_KEY, after);
    updateXpPill();
    sound('xp');
    showToast(`⚡ +${amount} XP${reason ? ' · ' + reason : ''}`, 'success', 2600);
    if (levelFor(after) > levelFor(before)) {
      setTimeout(() => {
        showToast(`🎉 Level up! You reached Level ${levelFor(after)}`, 'success', 4200);
        confettiBurst(90);
        sound('complete');
      }, 700);
    }
  }

  function updateXpPill() {
    const pill = $('xp-pill');
    if (!isAuthed()) return;
    const xp = xpGet();
    pill.textContent = `⚡ Lv ${levelFor(xp)}`;
    pill.title = `${xp} XP · ${levelProgress(xp)}/100 to next level`;
    if ($('settings-xp-box')) {
      $('settings-xp-box').innerHTML =
        `⚡ <strong>Level ${levelFor(xp)}</strong> · ${xp} XP total · ${100 - levelProgress(xp)} XP to level ${levelFor(xp) + 1}` +
        `<div class="progress" style="margin-top:8px;"><div class="progress-fill" style="width:${levelProgress(xp)}%"></div></div>`;
    }
  }

  function timeMap() { return jsonGet(TIME_KEY, {}); }
  function timeToday() { return timeMap()[todayKey()] || 0; }
  function addStudySeconds(sec) {
    const map = timeMap();
    map[todayKey()] = (map[todayKey()] || 0) + sec;
    const keys = Object.keys(map).sort();
    while (keys.length > 30) { delete map[keys.shift()]; }
    jsonSet(TIME_KEY, map);
  }

  function bestScores() { return jsonGet(BEST_KEY, {}); }
  function setBestScore(lessonId, score) {
    const map = bestScores();
    if (!map[lessonId] || score > map[lessonId]) { map[lessonId] = score; jsonSet(BEST_KEY, map); return true; }
    return false;
  }

  function lastQuizzes() { return jsonGet(LASTQUIZ_KEY, {}); }
  function recordQuizAttempt(meta, score) {
    const map = lastQuizzes();
    if (score >= 70) delete map[meta.lessonId];
    else map[meta.lessonId] = Object.assign({}, meta, { score, ts: Date.now() });
    jsonSet(LASTQUIZ_KEY, map);
  }

  /* ---------- daily goal ---------- */
  function dailyDoneMap() { return jsonGet(DAILYDONE_KEY, {}); }
  function lessonsToday() { return dailyDoneMap()[todayKey()] || 0; }
  function recordDailyLesson() {
    const map = dailyDoneMap();
    map[todayKey()] = (map[todayKey()] || 0) + 1;
    const keys = Object.keys(map).sort();
    while (keys.length > 30) { delete map[keys.shift()]; }
    jsonSet(DAILYDONE_KEY, map);
    updateGoalPill();
    if (lessonsToday() === settings.dailyGoal) {
      showToast(`🎯 Daily goal reached: ${lessonsToday()} lessons today!`, 'success', 4200);
      confettiBurst(70);
    }
  }
  function updateGoalPill() {
    const pill = $('goal-pill');
    if (!pill) return;
    if (!isAuthed()) { pill.classList.add('hidden'); return; }
    pill.classList.remove('hidden');
    const done = lessonsToday();
    const goal = Math.max(1, settings.dailyGoal || 1);
    pill.textContent = `🎯 ${done}/${goal}`;
    pill.title = `Daily goal: ${goal} lesson${goal > 1 ? 's' : ''} — ${done} done today`;
  }

  /* ---------- lesson title map (for the notes browser) ---------- */
  function rememberLessonTitle(lessonId, title, courseId) {
    if (!lessonId || !title) return;
    const map = jsonGet(TITLES_KEY, {});
    map[lessonId] = { title, courseId: courseId || (map[lessonId] || {}).courseId || '' };
    const keys = Object.keys(map);
    while (keys.length > 300) delete map[keys.shift()];
    jsonSet(TITLES_KEY, map);
  }
  function lessonTitleInfo(lessonId) { return jsonGet(TITLES_KEY, {})[lessonId] || {}; }

  /* ==========================================================
     12. STATE & ROUTER
     ========================================================== */
  const initialState = () => ({
    user: null,
    dashboard: null,
    course: null,
    lesson: null,
    lessonMeta: null,      // { courseId, moduleIndex, lessonIndex, offline }
    slides: [],
    slideIndex: 0,
    noteContent: '',
    noteDirty: false,
    tutorHistory: {},
    quiz: null,
    quizIndex: 0,
    quizAnswers: [],
    quizChecked: [],
    quizLocalResults: [],
    quizStartedAt: 0,
    quizTimer: null,
    quizSeconds: 0,
    quizStreakCount: 0,
    quizDone: false,
    wrongResults: [],
    practiceMode: false,
    lastScore: null,
    flash: null,
    touchStartX: 0,
    quizTouchStartX: 0,
    busy: false,
    unlockedThisSession: new Set()
  });

  let state = initialState();

  const isAuthed = () => !!lsGet('lj_token');
  const currentView = () => (document.querySelector('.view:not(.hidden)') || {}).id?.replace('view-', '') || '';

  function showView(name) {
    $$('.view').forEach((v) => v.classList.add('hidden'));
    const el = $('view-' + name);
    if (el) {
      el.classList.remove('hidden');
      if (el.focus) el.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
    const titles = {
      login: 'LearnJoy — Sign in',
      dashboard: 'LearnJoy — Dashboard',
      generate: 'LearnJoy — Create a course',
      course: 'LearnJoy — Course',
      lesson: state.lesson ? `LearnJoy — ${state.lesson.lessonTitle}` : 'LearnJoy — Lesson',
      mistakes: 'LearnJoy — Practice',
      flashcards: 'LearnJoy — Flashcards',
      quiz: 'LearnJoy — Quiz'
    };
    document.title = titles[name] || 'LearnJoy';
  }

  function go(route, param) {
    const hash = '#/' + route + (param ? '/' + encodeURIComponent(param) : '');
    if (location.hash === hash) handleRoute();
    else location.hash = hash;
  }

  function handleRoute() {
    const raw = (location.hash || '#/login').replace(/^#\//, '');
    const parts = raw.split('/').map(decodeURIComponent);
    const route = parts[0] || 'login';

    switch (route) {
      case 'dashboard':
        if (!isAuthed()) return go('login');
        showView('dashboard');
        refreshDashboard();
        break;
      case 'new':
        if (!isAuthed()) return go('login');
        showView('generate');
        break;
      case 'course':
        if (!isAuthed()) return go('login');
        if (parts[1]) openCourse(parts[1]);
        else go('dashboard');
        break;
      case 'lesson':
        if (!isAuthed()) return go('login');
        if (parts[1]) {
          // Deep link: #/lesson/<lessonId> — open straight from a shared URL.
          const lessonId = parts[1];
          if (state.lesson && state.lesson.lessonId === lessonId && state.slides.length) {
            showView('lesson');
            break;
          }
          const cached = cacheGet('lesson_' + lessonId);
          const courseId = (cached && cached.courseId) || (state.course && state.course.courseId) || '';
          const m = String(lessonId).match(/_m(\d+)_l(\d+)$/);
          if (courseId || cached) {
            openLesson(courseId, m ? Number(m[1]) : 0, m ? Number(m[2]) : 0, lessonId);
          } else {
            showToast('Open a course first so I can find that lesson.', 'error');
            go('dashboard');
          }
          break;
        }
        if (state.lesson && state.slides.length) { showView('lesson'); break; }
        if (state.course) go('course', state.course.courseId);
        else go('dashboard');
        break;
      case 'mistakes':
        if (state.quiz && state.quiz.questions && state.quiz.questions.length) showView('quiz');
        else go('lesson');
        break;
      case 'flashcards':
        if (state.flash && state.flash.deck) showView('flashcards');
        else go('lesson');
        break;
      case 'quiz':
        if (state.quiz) {
          showView('quiz');
          if (!state.quizTimer && !state.quizDone) {
            state.quizStartedAt = Date.now() - state.quizSeconds * 1000;
            startQuizTimer();
          }
        } else go('lesson');
        break;
      case 'login':
      default:
        showView('login');
        break;
    }
  }

  /* ==========================================================
     13. TOPBAR & AUTH
     ========================================================== */
  let authMode = 'login';

  function updateTopbar(user, streak) {
    const authed = isAuthed();
    $$('.auth-only').forEach((el) => el.classList.toggle('hidden', !authed));
    const pill = $('streak-pill');
    if (authed) {
      pill.classList.remove('hidden');
      pill.textContent = '🔥 ' + String(streak || 0);
      updateXpPill();
      $('xp-pill').classList.remove('hidden');
      updateGoalPill();
    } else {
      pill.classList.add('hidden');
      $('xp-pill').classList.add('hidden');
      if ($('goal-pill')) $('goal-pill').classList.add('hidden');
    }
    if (user) state.user = user;
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isReg = mode === 'register';
    $('tab-login').classList.toggle('active', !isReg);
    $('tab-register').classList.toggle('active', isReg);
    $('tab-login').setAttribute('aria-selected', String(!isReg));
    $('tab-register').setAttribute('aria-selected', String(isReg));
    $('auth-title').textContent = isReg ? 'Create your account' : 'Welcome back';
    $('auth-subtitle').textContent = isReg
      ? 'One minute to set up. A lifetime of bite-sized learning.'
      : 'Learn anything, bite by bite. No pressure, just progress.';
    $('btn-auth-submit').textContent = isReg ? 'Create Account' : 'Sign In';
    $('register-extras').classList.toggle('hidden', !isReg);
    $('auth-password').setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
    $('auth-error').classList.add('hidden');
  }

  function passwordStrength(pw) {
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return clamp(score, 0, 4);
  }

  function bindAuth() {
    $('tab-login').addEventListener('click', () => setAuthMode('login'));
    $('tab-register').addEventListener('click', () => {
      if ($('tab-register').classList.contains('hidden')) return;
      setAuthMode('register');
    });

    $('btn-show-password').addEventListener('click', () => {
      const inp = $('auth-password');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      $('btn-show-password').textContent = show ? '🙈' : '👁';
      $('btn-show-password').setAttribute('aria-pressed', String(show));
      $('btn-show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });

    $('auth-password').addEventListener('input', () => {
      if (authMode !== 'register') return;
      const s = passwordStrength($('auth-password').value);
      $('strength-fill').className = 'strength-fill' + (s ? ' s' + s : '');
      $('strength-label').textContent = ['', 'Weak — needs 8+ characters and more variety.', 'Okay — add numbers or symbols.', 'Good — nearly there!', 'Strong password. Nice!'][s];
    });

    // Client-side mirror of the backend's rules so users get instant feedback:
    // username: /^[a-z0-9._-]{3,30}$/ after lowercasing, password: 8+ chars.
    const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

    $('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('auth-username').value.trim().toLowerCase();
      const password = $('auth-password').value;
      $('auth-error').classList.add('hidden');

      if (!USERNAME_RE.test(username)) {
        return showAuthError('Usernames are 3–30 characters: lowercase letters, numbers, dots, dashes or underscores.');
      }
      if (password.length < 8) return showAuthError('Passwords need at least 8 characters.');
      if (authMode === 'register') {
        if ($('auth-password2').value !== password) return showAuthError('Passwords do not match.');
        if (passwordStrength(password) < 2) return showAuthError('That password is too weak — mix letters, numbers or symbols.');
      }

      $('btn-auth-submit').disabled = true;
      showLoading(authMode === 'login' ? 'Signing in…' : 'Creating your account…', { sub: Demo.active() ? 'Demo mode — data stays in this browser' : '' });
      try {
        const res = await api(authMode, { username, password, userAgent: navigator.userAgent }, { noAuth: true });
        lsSet('lj_token', res.session.token);
        lsSet('lj_user', JSON.stringify(res.user));
        if ($('auth-remember').checked) lsSet('lj_remember_user', username);
        else lsDel('lj_remember_user');
        state.user = res.user;
        sound('complete');
        showToast(authMode === 'login' ? `Welcome back, ${res.user.name || username}!` : 'Account created. Welcome!', 'success');
        go('dashboard');
      } catch (err) {
        showAuthError(err.message);
        showToast(err.message, 'error');
      } finally {
        $('btn-auth-submit').disabled = false;
        hideLoading();
      }
    });

    function showAuthError(msg) {
      const box = $('auth-error');
      box.textContent = msg;
      box.classList.remove('hidden');
      box.scrollIntoView({ block: 'nearest' });
    }

    $('btn-demo').addEventListener('click', async () => {
      Demo.enable();
      showLoading('Starting demo…', { sub: 'Everything runs locally in your browser', progress: true, tips: ['Planting seeds…', 'Growing lessons…'] });
      try {
        const res = await api('demoLogin', { username: lsGet('lj_remember_user') || 'explorer' }, { noAuth: true });
        lsSet('lj_token', res.session.token);
        lsSet('lj_user', JSON.stringify(res.user));
        state.user = res.user;
        showToast('🎮 Demo mode — your data stays in this browser', 'success');
        go('dashboard');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        hideLoading();
      }
    });
  }

  function bindTopbar() {
    $('btn-theme').addEventListener('click', toggleTheme);
    $('btn-settings').addEventListener('click', () => { updateXpPill(); openModal('modal-settings'); });
    $('btn-notes').addEventListener('click', openNotesModal);
    $('btn-dashboard').addEventListener('click', () => go('dashboard'));
    $('btn-new-course').addEventListener('click', () => go('new'));
    $('brand-home').addEventListener('click', (e) => {
      e.preventDefault();
      go(isAuthed() ? 'dashboard' : 'login');
    });
    $('btn-logout').addEventListener('click', async () => {
      showLoading('Signing out…');
      try { await api('logout'); } catch (e) { /* best effort */ }
      clearAuth();
      hideLoading();
      showToast('Signed out. See you soon! 👋');
    });
  }

  function clearAuth() {
    lsDel('lj_token');
    lsDel('lj_user');
    stopQuizTimer();
    state = initialState();
    updateTopbar(null, 0);
    go('login');
  }

  function afterAuth(user, dashboard) {
    const before = new Set((state.dashboard && state.dashboard.achievements || []).map((a) => a.type || ''));
    state.user = user;
    state.dashboard = dashboard;
    lsSet('lj_user', JSON.stringify(user));
    updateTopbar(user, dashboard.streak || 0);
    renderDashboard(dashboard);
    showView('dashboard');
    hideLoading();

    // Celebrate achievements earned since the last dashboard load.
    (dashboard.achievements || []).forEach((a) => {
      const t = a.type || '';
      if (t && !before.has(t) && !state.unlockedThisSession.has(t) && before.size >= 0 && state.dashboardLoadedOnce) {
        state.unlockedThisSession.add(t);
        showToast(`${a.icon || '🏅'} Achievement unlocked: ${a.name}!`, 'success', 5200);
        confettiBurst(80);
        sound('complete');
      }
      if (t) state.unlockedThisSession.add(t);
    });
    state.dashboardLoadedOnce = true;
  }

  /* ==========================================================
     14. THEME (light / dark / auto-follow-system)
     ========================================================== */
  const systemDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  function initTheme() {
    let stored = lsGet('lj_theme');
    if (!stored) {
      stored = systemDark() ? 'dark' : 'light';
      settings.themeMode = 'auto';
      saveSettings();
    }
    setTheme(stored, true);

    if (window.matchMedia) {
      try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
          if (settings.themeMode === 'auto') {
            document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            updateThemeButton();
          }
        });
      } catch (e) { /* very old browsers */ }
    }
  }

  function updateThemeButton() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const btn = $('btn-theme');
    btn.textContent = settings.themeMode === 'auto' ? '🌗' : (isDark ? '☀️' : '🌙');
    btn.setAttribute('aria-label',
      settings.themeMode === 'auto' ? 'Theme: auto (follows system). Click to switch.' :
        isDark ? 'Switch to light theme' : 'Switch to dark theme');
  }

  function setTheme(theme, silent) {
    document.documentElement.setAttribute('data-theme', theme);
    if (settings.themeMode !== 'auto') lsSet('lj_theme', theme);
    updateThemeButton();
    if (!silent) sound('click');
  }

  // light → dark → auto (follow system) → light …
  function toggleTheme() {
    if (settings.themeMode === 'manual') {
      const cur = document.documentElement.getAttribute('data-theme');
      if (cur === 'light') { setTheme('dark'); return; }
      settings.themeMode = 'auto';
      saveSettings();
      setTheme(systemDark() ? 'dark' : 'light');
      showToast('Theme: auto — follows your system 🌗');
      return;
    }
    settings.themeMode = 'manual';
    saveSettings();
    setTheme('light');
    showToast('Theme: light ☀️');
  }

  /* ==========================================================
     15. DASHBOARD
     ========================================================== */
  async function refreshDashboard() {
    renderDashboardSkeleton();
    try {
      const res = await api('getDashboard');
      cacheSet('dashboard', res);
      afterAuth(res.user, res);
    } catch (err) {
      hideLoading();
      const cached = cacheGet('dashboard');
      if (cached && isAuthed()) {
        showToast('Could not refresh — showing saved copy.', 'error');
        afterAuth(cached.user || state.user || {}, cached);
      } else {
        if (String(err.message).indexOf('Session expired') !== -1) return clearAuth();
        showToast(err.message, 'error');
        renderDashboard(state.dashboard || { courses: [], recentScores: [], achievements: [] });
      }
    }
  }

  function skeletonBlock(height, radius) {
    return `<div class="skeleton" style="height:${Number(height || 16)}px;border-radius:${Number(radius || 14)}px;"></div>`;
  }
  function skeletonLines(count, h) {
    let out = '';
    for (let i = 0; i < count; i++) out += `<div style="margin:10px 0;">${skeletonBlock(h || 16, 12)}</div>`;
    return out;
  }

  function renderDashboardSkeleton() {
    $('welcome-card').innerHTML =
      `<div style="display:grid; gap:12px;">${skeletonBlock(34, 16)}${skeletonBlock(18, 12)}` +
      `<div class="row">${skeletonBlock(44, 16)}${skeletonBlock(44, 16)}</div></div>`;
    $('stats-grid').innerHTML = [1, 2, 3, 4, 5, 6].map(() =>
      `<div class="card stat-card">${skeletonBlock(38, 14)}<div style="margin-top:10px;">${skeletonBlock(14, 10)}</div></div>`).join('');
    $('achievements-grid').innerHTML = [1, 2, 3, 4].map(() =>
      `<div class="badge-card">${skeletonBlock(42, 16)}<div style="margin-top:10px;">${skeletonBlock(14, 10)}</div></div>`).join('');
    $('courses-grid').innerHTML = [1, 2, 3].map(() =>
      `<div class="course-card">${skeletonBlock(24, 12)}<div style="margin:12px 0;">${skeletonBlock(14, 10)}</div>${skeletonBlock(14, 999)}</div>`).join('');
    $('recent-scores').innerHTML = skeletonLines(3, 18);
    $('score-chart').innerHTML = '';
  }

  function statCard(icon, label, value) {
    return `<div class="card stat-card"><div class="stat-value">${icon} ${esc(String(value))}</div>` +
      `<div class="stat-label">${esc(label)}</div></div>`;
  }

  function renderDashboard(d) {
    d = d || {};
    const user = d.user || {};
    const hour = new Date().getHours();
    const greeting = hour < 5 ? 'Burning the midnight oil' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    // Streak-at-risk: the backend streak only grows when a lesson is completed,
    // and lastActiveDate is the server's (script time zone) date.
    let streakWarn = '';
    const streak = Number(d.streak || 0);
    if (streak > 0 && user.lastActiveDate && user.lastActiveDate !== todayKey()) {
      streakWarn = `<p class="muted" style="margin-top:4px;"><strong>⚠️ Streak alert:</strong> complete one lesson today to keep your ${streak}-day streak alive!</p>`;
    }

    $('welcome-card').innerHTML =
      `<h1 tabindex="-1">${esc(greeting + ', ' + (user.name || user.username || 'learner'))}!</h1>` +
      `<p class="muted">🔥 ${esc(String(streak))} day streak · ${esc(String(d.completedLessons || 0))} lessons completed · ${esc(String(Math.round(timeToday() / 60)))} min studied today · 🎯 ${esc(String(lessonsToday()))}/${esc(String(settings.dailyGoal))} lessons today</p>` +
      streakWarn +
      `<div class="row">` +
      `<button class="btn btn-secondary" id="dash-generate">＋ Generate New Course</button>` +
      (d.continueCourseId ? `<button class="btn btn-secondary" id="dash-continue">▶ Continue Learning</button><button class="btn btn-secondary" id="dash-next-lesson">⏭ Next Lesson</button>` : '') +
      `<button class="btn btn-secondary" id="dash-notes">✍️ My Notes</button>` +
      `</div>`;
    $('dash-generate').addEventListener('click', () => go('new'));
    if (d.continueCourseId) {
      $('dash-continue').addEventListener('click', () => go('course', d.continueCourseId));
      $('dash-next-lesson').addEventListener('click', () => openNextLesson(d.continueCourseId));
    }
    $('dash-notes').addEventListener('click', openNotesModal);

    $('stats-grid').innerHTML = [
      statCard('📚', 'Courses', d.courses ? d.courses.length : 0),
      statCard('✅', 'Lessons Done', d.completedLessons || 0),
      statCard('🎯', 'Avg Quiz Score', d.averageScore ? d.averageScore + '%' : '—'),
      statCard('🔥', 'Day Streak', d.streak || 0),
      statCard('⚡', 'Level', levelFor(xpGet())),
      statCard('⏱', 'Today', Math.round(timeToday() / 60) + ' min')
    ].join('');

    renderReviewList();
    renderAchievements(d.achievements || []);
    renderCoursesGrid(d.courses || []);
    renderRecentScores(d.recentScores || []);
  }

  function renderAchievements(earned) {
    const earnedTypes = new Set((earned || []).map((a) => a.type || a.achievementType || '').filter(Boolean));
    const all = Object.keys(ACH_DEFS).map((type) => {
      const got = (earned || []).find((a) => (a.type || a.achievementType) === type);
      return { type, def: ACH_DEFS[type], earned: !!got, earnedAt: got ? got.earnedAt : '' };
    });
    $('achievements-grid').innerHTML = all.map((a) =>
      `<div class="badge-card${a.earned ? '' : ' locked'}" title="${esc(a.earned ? ('Earned ' + (a.earnedAt ? relTime(a.earnedAt) : '')) : 'Locked: ' + a.def.description)}">` +
      `<div class="badge-icon">${esc(a.def.icon)}</div>` +
      `<div class="badge-name">${esc(a.def.name)}</div>` +
      `<div class="muted small">${esc(a.def.description)}</div>` +
      (a.earned
        ? `<div class="tiny muted">✅ ${esc(a.earnedAt ? relTime(a.earnedAt) : 'Earned')}</div>`
        : `<div class="tiny muted">🔒 Locked</div>`) +
      `</div>`
    ).join('');
  }

  function renderCoursesGrid(courses) {
    if (!courses.length) {
      $('courses-grid').innerHTML = emptyBox('No courses yet. Generate your first course! 🚀');
      return;
    }
    $('courses-grid').innerHTML = courses.map((c) =>
      `<div class="card course-card" data-courseid="${esc(c.courseId)}" data-search="${esc(String(c.title || '').toLowerCase() + ' ' + String(c.description || '').toLowerCase())}" role="button" tabindex="0">` +
      `<h3>${esc(c.title)}</h3>` +
      `<p class="muted small">${esc(String(c.description || '').slice(0, 150))}</p>` +
      `<div class="progress"><div class="progress-fill" style="width:${Number(c.progressPercent || 0)}%"></div></div>` +
      `<div class="muted small course-meta">${esc(String(c.progressPercent || 0))}% complete · ${esc(String(c.totalLessons || 0))} lessons · ${esc(String(c.level || ''))}</div>` +
      `<div class="course-actions row">` +
      `<button class="btn btn-small btn-primary course-open" type="button">${Number(c.progressPercent || 0) >= 100 ? '🏆 Review' : Number(c.progressPercent || 0) > 0 ? '▶ Continue' : '🚀 Start'}</button>` +
      `<button class="btn btn-small btn-ghost course-next" type="button" title="Jump to the next incomplete lesson">⏭ Next lesson</button>` +
      `</div>` +
      `</div>`
    ).join('');
    $$('#courses-grid .course-card').forEach((card) => {
      const id = card.getAttribute('data-courseid');
      card.addEventListener('click', (e) => {
        if (e.target.closest('.course-next')) { openNextLesson(id); return; }
        go('course', id);
      });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('course', id); } });
    });
  }

  function filterCourses() {
    const q = $('course-search').value.trim().toLowerCase();
    $$('#courses-grid .course-card').forEach((card) => {
      card.classList.toggle('hidden', !!q && card.getAttribute('data-search').indexOf(q) === -1);
    });
  }

  function renderReviewList() {
    const items = Object.values(lastQuizzes()).sort((a, b) => b.ts - a.ts).slice(0, 5);
    const card = $('review-card');
    if (!items.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    $('review-list').innerHTML = items.map((it) =>
      `<div class="review-row">` +
      `<div><strong>${esc(it.lessonTitle || 'Lesson')}</strong>` +
      `<div class="muted tiny">${esc(it.courseTitle || '')} · ${esc(relTime(it.ts))}</div></div>` +
      `<div style="display:flex;gap:10px;align-items:center;">` +
      `<span class="score-chip">${esc(String(it.score))}%</span>` +
      `<button class="btn btn-small btn-primary" data-review-lesson="${esc(it.lessonId)}">Retake</button>` +
      `</div></div>`
    ).join('');
    $$('#review-list [data-review-lesson]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const it = items.find((x) => x.lessonId === btn.getAttribute('data-review-lesson'));
        if (it) reopenLesson(it);
      });
    });
  }

  async function reopenLesson(it) {
    showLoading('Opening lesson…');
    try {
      await openCourse(it.courseId, true);
      await openLesson(it.courseId, it.moduleIndex, it.lessonIndex, it.lessonId);
    } catch (err) {
      hideLoading();
      showToast(err.message, 'error');
    }
  }

  // Jump straight to the first incomplete lesson of a course.
  async function openNextLesson(courseId) {
    showLoading('Finding your next lesson…', { sub: 'Locating the first incomplete lesson' });
    try {
      let course = state.course && state.course.courseId === courseId ? state.course : null;
      if (!course) {
        const res = await api('getCourseById', { courseId });
        course = res.course;
        state.course = course;
        cacheSet('course_' + courseId, course);
      }
      let target = null;
      (course.modules || []).forEach((m) => {
        (m.lessons || []).forEach((l) => {
          if (!target && !l.completed) target = l;
        });
      });
      hideLoading();
      if (!target) {
        showToast('This course is 100% complete — pick another one! 🏆', 'success');
        go('course', courseId);
        return;
      }
      await openLesson(courseId, target.moduleIndex, target.lessonIndex, target.lessonId);
    } catch (err) {
      hideLoading();
      showToast(err.message, 'error');
    }
  }

  function renderRecentScores(scores) {
    if (!scores.length) {
      $('score-chart').innerHTML = '';
      $('recent-scores').innerHTML = emptyBox('No quiz scores yet — take your first quiz!');
      return;
    }
    const chrono = scores.slice(0, 10).reverse();
    $('score-chart').innerHTML = chrono.map((s) =>
      `<div class="chart-col" title="${esc(String(s.score))}% · ${esc(s.lessonTitle || '')}">` +
      `<div class="chart-bar${s.score < 70 ? ' low' : ''}" style="height:${Math.max(6, Number(s.score || 0) * 0.7)}px"></div>` +
      `<div class="chart-label">${esc(String(s.score || 0))}%</div></div>`
    ).join('');

    $('recent-scores').innerHTML =
      `<table class="table"><thead><tr><th>When</th><th>Course</th><th>Lesson</th><th>Score</th></tr></thead><tbody>` +
      scores.slice(0, 8).map((s) =>
        `<tr><td title="${esc(fmtDate(s.createdAt))}">${esc(relTime(s.createdAt))}</td>` +
        `<td>${esc(s.courseTitle)}</td><td>${esc(s.lessonTitle)}</td>` +
        `<td><strong>${esc(String(s.score))}%</strong></td></tr>`
      ).join('') + `</tbody></table>`;
  }

  /* ==========================================================
     16. GENERATE
     ========================================================== */
  const IDEAS = [
    'JavaScript basics', 'Spanish travel phrases', 'Astronomy for beginners', 'Chess openings',
    'Personal finance fundamentals', 'Watercolor painting', 'World War II in 10 events',
    'Music theory essentials', 'Python for data analysis', 'Public speaking confidence',
    'The solar system', 'Italian cooking basics', 'How memory works', 'Introduction to philosophy',
    'Photography composition', 'Negotiation skills', 'Climate science basics', 'Creative writing prompts'
  ];

  function bindGenerate() {
    $('btn-generate-back').addEventListener('click', () => go('dashboard'));

    $('btn-idea').addEventListener('click', () => {
      const t = $('gen-topic');
      let idea;
      do { idea = IDEAS[Math.floor(Math.random() * IDEAS.length)]; } while (idea === t.value);
      t.value = idea;
      t.dispatchEvent(new Event('input'));
      t.focus();
      sound('flip');
    });

    $('gen-topic').addEventListener('input', () => {
      $('gen-topic-count').textContent = `${$('gen-topic').value.length} / 200`;
    });
    $('gen-topic').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('btn-generate').click();
    });

    $('btn-generate').addEventListener('click', async () => {
      const topic = $('gen-topic').value.trim();
      if (topic.length < 3) {
        showToast('Enter a topic first (3+ characters)', 'error');
        $('gen-topic').focus();
        return;
      }
      if (state.busy) return;
      state.busy = true;
      $('btn-generate').disabled = true;
      showLoading('Generating your course…', {
        progress: true,
        sub: `“${topic.slice(0, 60)}”`,
        tips: ['Sketching modules…', 'Writing bite-sized lessons…', 'Preparing quizzes…', 'Polishing the cards…']
      });
      try {
        const res = await api('generateCourse', {
          prompt: topic,
          level: $('gen-level').value,
          timeAvailable: $('gen-time').value,
          learningStyle: $('gen-style').value
        });
        addXp(10, 'Course created');
        showToast('Course generated! 🎉', 'success');
        go('course', res.course.courseId);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        state.busy = false;
        $('btn-generate').disabled = false;
        hideLoading();
      }
    });
  }

  /* ==========================================================
     17. COURSE DETAIL
     ========================================================== */
  async function openCourse(courseId, silent) {
    showView('course');
    if (!silent) renderCourseSkeleton();
    try {
      const res = await api('getCourseById', { courseId });
      state.course = res.course;
      cacheSet('course_' + courseId, res.course);
      renderCourse(res.course);
    } catch (err) {
      const cached = cacheGet('course_' + courseId);
      if (cached) {
        state.course = cached;
        renderCourse(cached);
        showToast('Offline — showing saved course.', 'error');
      } else {
        if (String(err.message).indexOf('Session expired') !== -1) return clearAuth();
        $('course-detail').innerHTML = emptyBox(err.message);
        showToast(err.message, 'error');
      }
    } finally {
      hideLoading();
    }
  }

  function renderCourseSkeleton() {
    $('course-detail').innerHTML =
      `<div style="display:grid; gap:14px;">${skeletonBlock(38, 16)}${skeletonLines(2, 16)}` +
      `<div class="row">${skeletonBlock(34, 999)}${skeletonBlock(34, 999)}</div>` +
      `${skeletonBlock(16, 999)}${skeletonBlock(70, 22)}${skeletonBlock(70, 22)}${skeletonBlock(70, 22)}</div>`;
  }

  function renderCourse(c) {
    const badges =
      `<span class="badge">${esc(c.level || '')}</span>` +
      `<span class="badge">${esc(c.timeAvailable || '')}</span>` +
      `<span class="badge">${esc(c.learningStyle || '')}</span>` +
      `<span class="badge">${esc(String(c.estimatedHours || '?'))} h</span>`;

    let modulesHtml = '';
    if (!c.modules || !c.modules.length) {
      modulesHtml = emptyBox('No modules found.');
    } else {
      c.modules.forEach((m) => {
        modulesHtml += `<div class="module"><h3>${esc(m.title)}</h3>`;
        (m.lessons || []).forEach((l) => {
          const icon = l.completed ? '✅' : '📖';
          const label = l.completed ? 'Review' : 'Start';
          modulesHtml +=
            `<div class="subcard card-row lesson-row" role="button" tabindex="0" data-module="${esc(String(m.moduleIndex))}" data-lesson="${esc(String(l.lessonIndex))}" data-lessonid="${esc(l.lessonId || '')}">` +
            `<div class="lesson-main">` +
            `<div class="lesson-icon">${icon}</div>` +
            `<div><div class="lesson-title">${esc(l.title)}</div>` +
            `<div class="muted small">${esc(l.summary || '')}</div></div>` +
            `</div>` +
            `<button class="btn btn-small btn-secondary lesson-action" tabindex="-1">${label}</button>` +
            `</div>`;
        });
        modulesHtml += '</div>';
      });
    }

    $('course-detail').innerHTML =
      `<h1 tabindex="-1">${esc(c.title)}</h1>` +
      `<p class="muted">${textHtml(c.description || '')}</p>` +
      `<div class="row wrap">${badges}</div>` +
      `<div class="progress-wrap">` +
      `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(c.progressPercent || 0)}" aria-label="Course progress">` +
      `<div id="course-progress-fill" class="progress-fill"></div></div>` +
      `<div class="muted small" style="margin-top:8px;">${esc(String(c.completedCount || 0))} of ${esc(String(c.totalLessons || 0))} lessons complete</div>` +
      `</div>` +
      `<div class="row">` +
      `<button id="btn-refresh-course" class="btn btn-secondary btn-small" type="button">↻ Refresh</button>` +
      `<button id="btn-copy-outline" class="btn btn-ghost btn-small" type="button">📋 Copy outline</button>` +
      `</div>` +
      modulesHtml;

    setTimeout(() => {
      const fill = $('course-progress-fill');
      if (fill) fill.style.width = (c.progressPercent || 0) + '%';
    }, 60);

    $('btn-refresh-course').addEventListener('click', () => openCourse(c.courseId));
    $('btn-copy-outline').addEventListener('click', async () => {
      const lines = [`${c.title} — outline`, ''];
      (c.modules || []).forEach((m, i) => {
        lines.push(`Module ${i + 1}: ${m.title}`);
        (m.lessons || []).forEach((l) => lines.push(`  ${l.completed ? '[x]' : '[ ]'} ${l.title}`));
      });
      const ok = await copyText(lines.join('\n'));
      showToast(ok ? 'Outline copied to clipboard 📋' : 'Could not copy — clipboard blocked.', ok ? 'success' : 'error');
    });

    $$('#course-detail .lesson-row').forEach((row) => {
      const open = () => openLesson(
        c.courseId,
        Number(row.getAttribute('data-module')),
        Number(row.getAttribute('data-lesson')),
        row.getAttribute('data-lessonid') || undefined
      );
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  /* ==========================================================
     18. LESSON PLAYER
     ========================================================== */
  async function openLesson(courseId, moduleIndex, lessonIndex, lessonId) {
    showView('lesson');
    renderLessonSkeleton();
    state.lessonMeta = { courseId, moduleIndex, lessonIndex, lessonId: lessonId || '', offline: false };
    const params = lessonId
      ? { courseId, lessonId }                       // backend getLessonById fast path
      : { courseId, moduleIndex, lessonIndex };      // backend generateLesson path
    try {
      const res = await api('generateLesson', params);
      cacheSet('lesson_' + res.lesson.lessonId, res.lesson);
      rememberLessonTitle(res.lesson.lessonId, res.lesson.lessonTitle, courseId);
      renderLesson(res.lesson);
    } catch (err) {
      const fallbackId = lessonId || `${courseId}_m${moduleIndex}_l${lessonIndex}`;
      const cached = cacheGet('lesson_' + fallbackId);
      if (cached) {
        state.lessonMeta.offline = true;
        renderLesson(cached);
        showToast('Offline — showing saved lesson.', 'error');
      } else {
        if (String(err.message).indexOf('Session expired') !== -1 || String(err.message).indexOf('Not authenticated') !== -1) return clearAuth();
        $('lesson-slides').innerHTML = `<div class="slide-card">${emptyBox(err.message)}</div>`;
        showToast(err.message, 'error');
      }
    } finally {
      hideLoading();
    }
  }

  function renderLessonSkeleton() {
    $('lesson-progress-fill').style.width = '18%';
    $('lesson-count').textContent = '…';
    $('lesson-dots').innerHTML = '';
    $('lesson-slides').innerHTML =
      `<div class="slide-card">${skeletonBlock(68, 24)}<div style="margin:14px 0;">${skeletonBlock(30, 14)}</div>${skeletonLines(5, 16)}</div>`;
  }

  function buildLessonSlides(l) {
    const content = l.content || {};
    const exercise = content.exercise || {};
    const slides = [];

    slides.push({
      kind: 'intro', emoji: '📘', title: 'Lesson',
      html:
        `<h1 tabindex="-1">${esc(l.lessonTitle)}</h1>` +
        `<p class="muted">${esc(l.moduleTitle || '')}</p>` +
        `<div class="chips"><span class="chip">⏱ ${esc(String(content.estimatedMinutes || 7))} min</span>` +
        (l.completed ? `<span class="chip">✅ Completed</span>` : '') +
        (state.lessonMeta && state.lessonMeta.offline ? `<span class="chip">📡 Offline copy</span>` : '') + `</div>` +
        `<div>${textHtml(content.introduction || '')}</div>`
    });

    (content.keyPoints || []).forEach((point, i) => {
      slides.push({
        kind: 'key', emoji: '💡', title: `Key point ${i + 1} of ${(content.keyPoints || []).length}`,
        html: `<div class="big-text">${textHtml(point)}</div>`
      });
    });

    (content.examples || []).forEach((example, i) => {
      slides.push({
        kind: 'example', emoji: '🧪', title: `Example ${i + 1} of ${(content.examples || []).length}`,
        html: `<div>${textHtml(example)}</div>`
      });
    });

    (content.commonMistakes || []).forEach((mistake, i) => {
      slides.push({
        kind: 'mistake', emoji: '⚠️', title: `Watch out ${i + 1} of ${(content.commonMistakes || []).length}`,
        html: `<div class="big-text">${textHtml(mistake)}</div>`
      });
    });

    slides.push({
      kind: 'exercise', emoji: '🛠️', title: 'Practice exercise',
      html:
        `<div class="big-text">${textHtml(exercise.prompt || 'Try a short practice exercise.')}</div>` +
        `<div class="row">` +
        `<button class="btn btn-small btn-secondary" type="button" id="btn-show-hint">💡 Show Hint</button>` +
        `<button class="btn btn-small btn-secondary" type="button" id="btn-show-solution">🔓 Show Solution</button>` +
        `</div>` +
        `<div id="exercise-hint" class="callout hidden">${textHtml(exercise.hint || '')}</div>` +
        `<div id="exercise-solution" class="callout hidden">${textHtml(exercise.solution || '')}</div>`
    });

    if (content.summary) {
      slides.push({ kind: 'summary', emoji: '🎯', title: 'Summary', html: `<div>${textHtml(content.summary)}</div>` });
    }

    slides.push({
      kind: 'note', emoji: '✍️', title: 'Your note',
      html:
        `<p class="muted">Write a tiny note to future you — it autosaves to this lesson.</p>` +
        `<textarea id="note-content" maxlength="2000" placeholder="What do you want to remember?">${esc(state.noteContent || '')}</textarea>` +
        `<div class="row spread">` +
        `<span id="note-status" class="note-status"></span>` +
        `<button class="btn btn-small btn-secondary" type="button" id="btn-save-note">Save now</button>` +
        `</div>`
    });

    slides.push({
      kind: 'finish', emoji: '🎉', title: 'Ready to lock it in?',
      html:
        `<div class="big-text">Nice work getting through the lesson. Mark it complete, flip some flashcards, or jump into the quiz.</div>` +
        `<div class="row">` +
        `<button class="btn btn-primary" type="button" id="slide-complete">${l.completed ? 'Completed ✅' : '✓ Complete Lesson'}</button>` +
        `<button class="btn btn-secondary" type="button" id="slide-quiz">🧠 Take Quiz</button>` +
        `<button class="btn btn-secondary" type="button" id="slide-flash">🃏 Flashcards</button>` +
        `</div>`
    });

    return slides;
  }

  function renderLesson(l) {
    state.lesson = l;
    state.slides = buildLessonSlides(l);
    state.slideIndex = 0;
    state.noteContent = '';
    state.noteDirty = false;

    renderSlide('fwd');
    updateLessonActions();
    resetTutor();
    loadNote(l.lessonId);

    $('tutor-body').classList.add('hidden');
    $('tutor-toggle').setAttribute('aria-expanded', 'false');
    $('tutor-chevron').textContent = '▾';
  }

  function renderDots(containerId, total, index, extraClassFor) {
    const wrap = $(containerId);
    wrap.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dot' + (i === index ? ' active' : '') + (extraClassFor ? ' ' + (extraClassFor(i) || '') : '');
      b.setAttribute('aria-label', `Go to ${i + 1} of ${total}`);
      b.addEventListener('click', () => {
        if (containerId === 'lesson-dots') {
          const dir = i > state.slideIndex ? 'fwd' : 'back';
          state.slideIndex = i;
          renderSlide(dir);
        } else {
          state.quizIndex = i;
          renderQuizQuestion();
        }
      });
      wrap.appendChild(b);
    }
  }

  function renderSlide(dir) {
    if (!state.slides.length) return;
    const slide = state.slides[state.slideIndex];
    const total = state.slides.length;

    $('lesson-slides').innerHTML =
      `<div class="slide-card slide-${esc(slide.kind)}${dir === 'back' ? ' back-in' : ''}">` +
      `<div class="slide-emoji">${slide.emoji}</div>` +
      `<div class="slide-kicker">${esc(slide.title)}</div>` +
      `<div class="slide-body">${slide.html}</div>` +
      `</div>`;

    const pct = ((state.slideIndex + 1) / total) * 100;
    $('lesson-progress-fill').style.width = pct + '%';
    $('lesson-progress-bar').setAttribute('aria-valuenow', String(Math.round(pct)));
    $('lesson-count').textContent = `${state.slideIndex + 1}/${total}`;
    $('btn-slide-prev').disabled = state.slideIndex === 0;
    $('btn-slide-next').textContent = state.slideIndex === total - 1
      ? (state.lesson && state.lesson.completed ? 'Take Quiz 🧠' : 'Finish 🎉')
      : 'Next →';

    renderDots('lesson-dots', total, state.slideIndex);

    if (slide.kind === 'exercise') {
      $('btn-show-hint').addEventListener('click', () => toggleHidden('exercise-hint'));
      $('btn-show-solution').addEventListener('click', () => toggleHidden('exercise-solution'));
    }

    if (slide.kind === 'note') {
      const noteEl = $('note-content');
      noteEl.value = state.noteContent || '';
      let debounce = null;
      noteEl.addEventListener('input', () => {
        state.noteContent = noteEl.value;
        state.noteDirty = true;
        $('note-status').textContent = 'Typing…';
        $('note-status').classList.remove('saved');
        clearTimeout(debounce);
        debounce = setTimeout(() => saveNote(true), 900);
      });
      $('btn-save-note').addEventListener('click', () => saveNote(false));
      if ($('note-status') && !state.noteDirty) $('note-status').textContent = '';
    }

    if (slide.kind === 'finish') {
      const completeBtn = $('slide-complete');
      completeBtn.disabled = !!(state.lesson && state.lesson.completed);
      completeBtn.addEventListener('click', completeLesson);
      $('slide-quiz').addEventListener('click', takeQuiz);
      $('slide-flash').addEventListener('click', startFlashcards);
    }
  }

  function toggleHidden(id) {
    const el = $(id);
    if (el) el.classList.toggle('hidden');
  }

  function nextSlide() {
    if (!state.slides.length) return;
    if (state.slideIndex < state.slides.length - 1) {
      state.slideIndex++;
      renderSlide('fwd');
    } else if (state.lesson && !state.lesson.completed) {
      completeLesson();
    } else {
      takeQuiz();
    }
  }

  function prevSlide() {
    if (state.slideIndex > 0) {
      state.slideIndex--;
      renderSlide('back');
    }
  }

  function updateLessonActions() {
    const completeBtn = $('btn-complete-lesson');
    if (!completeBtn) return;
    if (state.lesson && state.lesson.completed) {
      completeBtn.textContent = 'Completed ✅';
      completeBtn.disabled = true;
    } else {
      completeBtn.textContent = '✓ Complete Lesson';
      completeBtn.disabled = false;
    }
  }

  function setButtonLoading(id, loading, text) {
    const btn = $(id);
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = text || 'Working…';
    } else {
      btn.disabled = false;
      if (btn.dataset.origText) btn.textContent = btn.dataset.origText;
      delete btn.dataset.origText;
    }
  }

  /* ---------- notes ---------- */
  async function loadNote(lessonId) {
    try {
      const res = await api('getNotes', { lessonId });
      // Guards against two races: the lesson changed while the request was in
      // flight, or the user already started typing (their text wins).
      if (!state.lesson || state.lesson.lessonId !== lessonId) return;
      if (state.noteDirty) return;
      state.noteContent = res.notes && res.notes.length ? (res.notes[0].content || '') : '';
      const el = $('note-content');
      if (el && document.activeElement !== el) el.value = state.noteContent;
    } catch (e) { /* non-fatal */ }
  }

  async function saveNote(auto) {
    if (!state.lesson) return;
    if (!auto) setButtonLoading('btn-save-note', true, 'Saving…');
    const status = $('note-status');
    if (status) { status.textContent = 'Saving…'; status.classList.remove('saved'); }
    try {
      await api('saveNote', { lessonId: state.lesson.lessonId, content: state.noteContent || '' });
      state.noteDirty = false;
      if (status) { status.textContent = 'Saved ✓'; status.classList.add('saved'); }
      if (!auto) { showToast('Note saved ✍️', 'success'); addXp(2, 'Note saved'); }
    } catch (err) {
      if (status) status.textContent = 'Save failed';
      if (!auto) showToast(err.message, 'error');
    } finally {
      if (!auto) setButtonLoading('btn-save-note', false);
    }
  }

  /* ---------- complete lesson ---------- */
  async function completeLesson() {
    if (!state.lesson || state.lesson.completed || state.busy) return;
    state.busy = true;
    setButtonLoading('btn-complete-lesson', true, 'Saving…');
    setButtonLoading('slide-complete', true, 'Saving…');
    try {
      const res = await api('markLessonComplete', { courseId: state.lesson.courseId, lessonId: state.lesson.lessonId });
      state.lesson.completed = true;
      if (state.user) {
        state.user.streak = res.streak;
        state.user.totalLessons = res.totalLessons;
        lsSet('lj_user', JSON.stringify(state.user));
      }
      updateTopbar(state.user, res.streak);
      updateLessonActions();
      renderSlide('fwd');
      recordDailyLesson();
      sound('complete');
      confettiBurst(120);
      addXp(25, 'Lesson complete');
      if (res.courseCompleted) {
        addXp(50, 'Course complete!');
        setTimeout(() => showToast('🏆 Course complete! Amazing!', 'success', 5000), 400);
        confettiBurst(200);
      }
    } catch (err) {
      setButtonLoading('btn-complete-lesson', false);
      setButtonLoading('slide-complete', false);
      showToast(err.message, 'error');
    } finally {
      state.busy = false;
    }
  }

  /* ---------- tutor ---------- */
  function resetTutor() {
    $('tutor-messages').innerHTML = '';
    appendTutorMessage('assistant', 'Hi! I’m your AI tutor. Ask me anything about this lesson — I keep answers short and helpful.');
  }

  function appendTutorMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'tutor-msg ' + role;
    div.innerHTML = textHtml(text);
    $('tutor-messages').appendChild(div);
    $('tutor-messages').scrollTop = $('tutor-messages').scrollHeight;
    return div;
  }

  async function sendTutor(preset) {
    if (!state.lesson) return;
    const input = $('tutor-input');
    const question = (preset || input.value).trim();
    if (!question) return;

    appendTutorMessage('user', question);
    input.value = '';
    input.disabled = true;
    $('btn-tutor-send').disabled = true;
    const typing = appendTutorMessage('assistant', '');
    typing.classList.add('typing');
    typing.innerHTML = '<span></span><span></span><span></span>';

    try {
      const res = await api('askTutor', { lessonId: state.lesson.lessonId, question });
      typing.remove();
      appendTutorMessage('assistant', res.answer || 'Hmm, I’m not sure about that one — try rephrasing?');
    } catch (err) {
      typing.remove();
      appendTutorMessage('system', '⚠️ ' + err.message);
    } finally {
      input.disabled = false;
      $('btn-tutor-send').disabled = false;
      input.focus();
    }
  }

  function bindTutor() {
    $('btn-tutor-send').addEventListener('click', () => sendTutor());
    $('tutor-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTutor(); });
    $('tutor-toggle').addEventListener('click', () => {
      const body = $('tutor-body');
      const open = body.classList.toggle('hidden') === false;
      $('tutor-chevron').textContent = open ? '▴' : '▾';
      $('tutor-toggle').setAttribute('aria-expanded', String(open));
      if (open) $('tutor-input').focus();
    });
    $$('#tutor-suggestions .chip-btn').forEach((chip) => {
      chip.addEventListener('click', () => sendTutor(chip.textContent));
    });
  }

  /* ==========================================================
     19. FLASHCARDS
     ========================================================== */
  function buildDeck(l) {
    const content = l.content || {};
    const deck = [];
    const cue = (text) => {
      const words = String(text).split(' ');
      return words.length > 9 ? words.slice(0, 9).join(' ') + '…' : text;
    };
    (content.keyPoints || []).forEach((p, i) => deck.push({ tag: `💡 Key point ${i + 1}`, front: cue(p), back: p }));
    (content.commonMistakes || []).forEach((p, i) => deck.push({ tag: `⚠️ Watch out ${i + 1}`, front: cue(p), back: p }));
    if (content.exercise && content.exercise.prompt) {
      deck.push({
        tag: '🛠️ Exercise',
        front: content.exercise.prompt,
        back: (content.exercise.solution || content.exercise.hint || 'No solution provided.')
      });
    }
    return deck;
  }

  function startFlashcards() {
    if (!state.lesson) return;
    const deck = buildDeck(state.lesson);
    if (!deck.length) { showToast('No flashcards available for this lesson.', 'error'); return; }
    state.flash = { deck: deck.map((c) => Object.assign({}, c)), index: 0, known: 0, total: deck.length, flipped: false };
    $('flash-area').classList.remove('hidden');
    $('flash-done').classList.add('hidden');
    renderFlash();
    go('flashcards');
  }

  function renderFlash() {
    const f = state.flash;
    if (!f || !f.deck.length) return;
    const card = f.deck[f.index];
    $('flash-front').innerHTML = `<div class="flash-tag">${esc(card.tag)}</div><div class="flash-text">${esc(card.front)}</div><div class="tiny muted">tap to flip</div>`;
    $('flash-back').innerHTML = `<div class="flash-tag">${esc(card.tag)}</div><div class="flash-text">${textHtml(card.back)}</div>`;
    $('flash-card').classList.remove('flipped');
    f.flipped = false;
    const done = f.total - f.deck.length;
    $('flash-count').textContent = `${Math.min(done + 1, f.total)}/${f.total}`;
    $('flash-progress-fill').style.width = ((done / f.total) * 100) + '%';
  }

  function flipFlash() {
    if (!state.flash || !state.flash.deck.length) return;
    state.flash.flipped = !state.flash.flipped;
    $('flash-card').classList.toggle('flipped', state.flash.flipped);
    sound('flip');
  }

  function gradeFlash(known) {
    const f = state.flash;
    if (!f || !f.deck.length) return;
    if (known) {
      f.known++;
      f.deck.splice(f.index, 1);
      sound('correct');
    } else {
      f.deck.push(f.deck.splice(f.index, 1)[0]);
      sound('wrong');
    }
    if (f.index >= f.deck.length) f.index = 0;
    if (!f.deck.length) { finishFlash(); return; }
    renderFlash();
  }

  function finishFlash() {
    const f = state.flash;
    $('flash-area').classList.add('hidden');
    $('flash-done').classList.remove('hidden');
    $('flash-score').textContent = `${f.known}/${f.total}`;
    $('flash-progress-fill').style.width = '100%';
    $('flash-count').textContent = 'Done';
    $('flash-done-label').textContent = f.known === f.total ? 'Perfect recall! 🤩' : 'Deck complete!';
    sound('complete');
    confettiBurst(90);
    addXp(10, 'Flashcards done');
  }

  function bindFlash() {
    $('btn-flash-back').addEventListener('click', () => go('lesson'));
    $('flash-card').addEventListener('click', flipFlash);
    $('flash-card').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipFlash(); } });
    $('btn-flash-again').addEventListener('click', () => gradeFlash(false));
    $('btn-flash-know').addEventListener('click', () => gradeFlash(true));
    $('btn-flash-shuffle').addEventListener('click', () => {
      const f = state.flash;
      if (!f) return;
      f.deck = shuffled(Math.random, f.deck);
      f.index = 0;
      renderFlash();
      sound('flip');
    });
    $('btn-flash-restart').addEventListener('click', startFlashcards);
    $('btn-flash-to-quiz').addEventListener('click', takeQuiz);
  }

  /* ==========================================================
     20. QUIZ
     ========================================================== */
  async function takeQuiz() {
    if (!state.lesson) return;
    showView('quiz');
    renderQuizSkeleton();
    try {
      const res = await api('generateQuiz', { courseId: state.lesson.courseId, lessonId: state.lesson.lessonId });
      startQuiz(res.quiz);
    } catch (err) {
      const cached = cacheGet('quiz_' + state.lesson.lessonId);
      if (cached) {
        startQuiz(cached);
        showToast('Offline — reusing a saved quiz.', 'error');
      } else {
        if (String(err.message).indexOf('Session expired') !== -1) return clearAuth();
        $('quiz-slide').innerHTML = `<div class="slide-card">${emptyBox(err.message)}</div>`;
        showToast(err.message, 'error');
      }
    } finally {
      hideLoading();
    }
  }

  function renderQuizSkeleton() {
    $('quiz-progress-fill').style.width = '18%';
    $('quiz-count').textContent = '…';
    $('quiz-dots').innerHTML = '';
    $('quiz-slide').innerHTML =
      `<div class="slide-card">${skeletonBlock(18, 12)}<div style="margin:14px 0;">${skeletonBlock(34, 16)}</div>` +
      `${skeletonBlock(54, 18)}<div style="margin:10px 0;">${skeletonBlock(54, 18)}</div>${skeletonBlock(54, 18)}</div>`;
    $('quiz-feedback').classList.add('hidden');
  }

  function startQuiz(quiz) {
    state.quiz = quiz;
    state.quizIndex = 0;
    state.quizAnswers = (quiz.questions || []).map(() => null);
    state.quizChecked = (quiz.questions || []).map(() => false);
    state.quizLocalResults = (quiz.questions || []).map(() => null);
    state.lastScore = null;
    state.quizStreakCount = 0;
    state.quizDone = false;
    state.quizSeconds = 0;
    state.quizStartedAt = Date.now();
    cacheSet('quiz_' + state.lesson.lessonId, quiz);

    $('quiz-nav').classList.remove('hidden');
    $('quiz-streak').classList.add('hidden');
    startQuizTimer();
    renderQuizQuestion();
  }

  function startQuizTimer() {
    stopQuizTimer();
    $('quiz-timer').textContent = '⏱ 0:00';
    state.quizTimer = setInterval(() => {
      state.quizSeconds = Math.floor((Date.now() - state.quizStartedAt) / 1000);
      $('quiz-timer').textContent = '⏱ ' + fmtClock(state.quizSeconds);
    }, 1000);
  }
  function stopQuizTimer() {
    if (state.quizTimer) { clearInterval(state.quizTimer); state.quizTimer = null; }
  }

  function quizDotClass(i) {
    if (state.quizChecked[i]) return state.quizLocalResults[i] && state.quizLocalResults[i].correct ? 'done' : 'wrong';
    return '';
  }

  function renderQuizQuestion() {
    if (!state.quiz || !state.quiz.questions || !state.quiz.questions.length) {
      $('quiz-slide').innerHTML = `<div class="slide-card">${emptyBox('No quiz available.')}</div>`;
      return;
    }
    const i = state.quizIndex;
    const q = state.quiz.questions[i];
    const total = state.quiz.questions.length;
    const checked = state.quizChecked[i];
    const answer = state.quizAnswers[i];
    const localResult = state.quizLocalResults[i];

    let html =
      `<div class="slide-card quiz-question">` +
      `<div class="slide-kicker">${state.practiceMode ? '🔁 Practice · ' : ''}Question ${i + 1} of ${total}${q.type === 'tf' ? ' · True or False' : q.type === 'short' ? ' · Type your answer' : ''}</div>` +
      `<h2 class="question-prompt">${esc(q.prompt)}</h2>`;

    if (q.type === 'mc') {
      html += `<div class="options">`;
      (q.options || []).forEach((opt, oi) => {
        const selected = answer === opt;
        let cls = 'option';
        if (selected) cls += ' selected';
        if (checked) {
          cls += ' disabled';
          if (opt === q.answer) cls += ' correct';
          else if (selected) cls += ' incorrect';
        }
        html +=
          `<label class="${cls}">` +
          `<input type="radio" name="quiz-option" value="${esc(opt)}" ${selected ? 'checked' : ''} ${checked ? 'disabled' : ''}>` +
          `<span class="opt-key">${oi + 1}</span><span>${esc(opt)}</span>` +
          `</label>`;
      });
      html += `</div>`;
    } else if (q.type === 'tf') {
      const trueSelected = answer === 'true';
      const falseSelected = answer === 'false';
      const correctBool = normalizeBoolLocal(q.answer);
      let trueCls = 'option' + (trueSelected ? ' selected' : '');
      let falseCls = 'option' + (falseSelected ? ' selected' : '');
      if (checked) {
        trueCls += ' disabled'; falseCls += ' disabled';
        if (correctBool) trueCls += ' correct'; else falseCls += ' correct';
        if (trueSelected && !correctBool) trueCls += ' incorrect';
        if (falseSelected && correctBool) falseCls += ' incorrect';
      }
      html +=
        `<div class="options">` +
        `<label class="${trueCls}"><input type="radio" name="quiz-option" value="true" ${trueSelected ? 'checked' : ''} ${checked ? 'disabled' : ''}> <span class="opt-key">T</span><span>True</span></label>` +
        `<label class="${falseCls}"><input type="radio" name="quiz-option" value="false" ${falseSelected ? 'checked' : ''} ${checked ? 'disabled' : ''}> <span class="opt-key">F</span><span>False</span></label>` +
        `</div>`;
    } else {
      let shortCls = 'short-answer';
      if (checked && localResult) shortCls += localResult.correct ? ' correct' : ' incorrect';
      html += `<input class="${shortCls}" id="quiz-short" placeholder="Your answer" autocomplete="off" value="${esc(answer || '')}" ${checked ? 'disabled' : ''}>`;
    }
    html += `</div>`;

    $('quiz-slide').innerHTML = html;
    const pct = ((i + 1) / total) * 100;
    $('quiz-progress-fill').style.width = pct + '%';
    $('quiz-progress-bar').setAttribute('aria-valuenow', String(Math.round(pct)));
    $('quiz-count').textContent = `${i + 1}/${total}`;
    renderDots('quiz-dots', total, i, quizDotClass);

    if (!checked) {
      $('quiz-feedback').classList.add('hidden');
      $('btn-quiz-check').classList.remove('hidden');
      $('btn-quiz-next').classList.add('hidden');
      $('btn-quiz-check').disabled = !hasCurrentAnswer();

      $$('input[name="quiz-option"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          state.quizAnswers[i] = radio.value;
          $$('.option').forEach((el) => el.classList.remove('selected'));
          if (radio.closest('.option')) radio.closest('.option').classList.add('selected');
          $('btn-quiz-check').disabled = false;
          sound('click');
        });
      });

      const short = $('quiz-short');
      if (short) {
        short.addEventListener('input', () => {
          state.quizAnswers[i] = short.value;
          $('btn-quiz-check').disabled = !short.value.trim();
        });
        short.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !state.quizChecked[i] && short.value.trim()) { e.preventDefault(); checkCurrentQuestion(); }
        });
        short.focus();
      }
    } else {
      showQuizFeedback(localResult);
      $('btn-quiz-check').classList.add('hidden');
      $('btn-quiz-next').classList.remove('hidden');
      $('btn-quiz-next').textContent = i === total - 1 ? 'See Results 🏁' : 'Continue →';
    }
  }

  function hasCurrentAnswer() {
    const a = state.quizAnswers[state.quizIndex];
    return a !== null && a !== undefined && String(a).trim() !== '';
  }

  function checkCurrentQuestion() {
    const i = state.quizIndex;
    if (!state.quiz || state.quizChecked[i] || !hasCurrentAnswer()) return;
    const result = gradeQuestionLocal(state.quiz.questions[i], state.quizAnswers[i]);
    state.quizChecked[i] = true;
    state.quizLocalResults[i] = result;
    if (result.correct) {
      state.quizStreakCount++;
      sound('correct');
      if (state.quizStreakCount >= 2) {
        $('quiz-streak').textContent = `⚡ ${state.quizStreakCount} in a row`;
        $('quiz-streak').classList.remove('hidden');
      }
    } else {
      state.quizStreakCount = 0;
      $('quiz-streak').classList.add('hidden');
      sound('wrong');
    }
    renderQuizQuestion();
  }

  function continueQuiz() {
    const total = state.quiz.questions.length;
    if (state.quizIndex < total - 1) {
      state.quizIndex++;
      renderQuizQuestion();
    } else if (state.practiceMode) {
      const fixed = state.quizLocalResults.filter((r) => r && r.correct).length;
      renderPracticeFinal(fixed, total);
      state.practiceMode = false;
      addXp(8, 'Practice round');
    } else {
      finishQuiz();
    }
  }

  function showQuizFeedback(result) {
    const fb = $('quiz-feedback');
    fb.className = 'quiz-feedback ' + (result.correct ? 'correct' : 'incorrect');
    fb.innerHTML =
      `<div>${result.correct ? '✅ Correct!' : '❌ Not quite'}</div>` +
      (!result.correct ? `<div class="small" style="margin-top:6px;"><strong>Answer:</strong> ${textHtml(result.correctAnswer || '—')}</div>` : '') +
      `<div class="feedback-explanation">${textHtml(result.explanation || '')}</div>`;
    fb.classList.remove('hidden');
  }

  async function finishQuiz() {
    $('quiz-nav').classList.add('hidden');
    $('quiz-feedback').classList.add('hidden');
    stopQuizTimer();
    state.quizDone = true;
    renderQuizSkeleton();

    const answers = state.quiz.questions.map((q, i) => ({
      questionId: q.id,
      answer: state.quizAnswers[i] === null ? '' : state.quizAnswers[i]
    }));

    try {
      const res = await api('submitQuiz', { courseId: state.lesson.courseId, lessonId: state.lesson.lessonId, answers });
      renderQuizFinal(res);
    } catch (err) {
      if (String(err.message).indexOf('Session expired') !== -1) return clearAuth();
      // Fall back to local grading so effort is never lost offline.
      const results = state.quiz.questions.map((q, i) => {
        const g = gradeQuestionLocal(q, state.quizAnswers[i]);
        return { prompt: q.prompt, userAnswer: g.userAnswer, correctAnswer: g.correctAnswer, correct: g.correct };
      });
      const correct = results.filter((r) => r.correct).length;
      const score = results.length ? Math.round((correct / results.length) * 100) : 0;
      showToast('Saved locally — will sync when online.', 'error');
      renderQuizFinal({ score, correct, total: results.length, results, offline: true });
    }
  }

  function renderQuizFinal(res) {
    state.lastScore = res.score;

    // Practice rounds never touch real stats.
    if (state.practiceMode) state.practiceMode = false;

    const isBest = setBestScore(state.lesson.lessonId, res.score);
    const best = bestScores()[state.lesson.lessonId] || res.score;
    const speedrun = res.score === 100 && state.quizSeconds > 0 && state.quizSeconds <= 30;
    const xpGain = (res.correct || 0) * 5 + (res.score === 100 ? 20 : 0) + (speedrun ? 15 : 0);

    recordQuizAttempt({
      lessonId: state.lesson.lessonId,
      courseId: state.lesson.courseId,
      moduleIndex: state.lessonMeta ? state.lessonMeta.moduleIndex : 0,
      lessonIndex: state.lessonMeta ? state.lessonMeta.lessonIndex : 0,
      lessonTitle: state.lesson.lessonTitle,
      courseTitle: state.course ? state.course.title : ''
    }, res.score);

    // Remember which questions were missed for the mistakes-only drill.
    const resultsList = res.results || [];
    state.wrongResults = (state.quiz && state.quiz.questions ? state.quiz.questions : [])
      .map((q, i) => ({ q, r: resultsList[i] }))
      .filter((x) => x.r && x.r.correct === false)
      .map((x) => x.q);

    $('quiz-slide').innerHTML =
      `<div class="slide-card quiz-final">` +
      `<div class="score-card">` +
      `<div class="score-number">${esc(String(res.score))}%</div>` +
      `<div><strong>${esc(String(res.correct))} of ${esc(String(res.total))} correct</strong> · ⏱ ${esc(fmtClock(state.quizSeconds))}</div>` +
      (speedrun ? `<div class="tiny" style="margin-top:6px;">⚡ Speedrun bonus: perfect in under 30s!</div>` : '') +
      (res.offline ? `<div class="tiny" style="margin-top:6px;">📡 graded locally (offline)</div>` : '') +
      `</div>` +
      (isBest && res.score > 0 ? `<p class="center"><span class="badge">🏅 New personal best!</span></p>` : `<p class="center muted small">Personal best: ${esc(String(best))}%</p>`) +
      `<h2>Question recap</h2>` +
      resultsList.map((r) =>
        `<div class="result-item ${r.correct ? 'correct' : 'incorrect'}">` +
        `<div class="result-icon">${r.correct ? '✅' : '❌'}</div>` +
        `<div><div class="result-prompt">${esc(r.prompt)}</div>` +
        `<div class="muted small">Your answer: ${esc(r.userAnswer || '—')} · Correct: ${esc(r.correctAnswer || '—')}</div></div>` +
        `</div>`
      ).join('') +
      `<div class="row wrap">` +
      `<button class="btn btn-secondary" id="quiz-back-lesson" type="button">← Back to Lesson</button>` +
      `<button class="btn btn-secondary" id="btn-retake-quiz" type="button">🔁 Retake Quiz</button>` +
      (state.wrongResults.length ? `<button class="btn btn-secondary" id="btn-review-mistakes" type="button">🔍 Review Mistakes (${state.wrongResults.length})</button>` : '') +
      (res.score < 70 ? `<button class="btn btn-primary" id="btn-generate-review" type="button">🧩 Generate Review</button>` : '') +
      `</div>` +
      `<div id="review-area"></div>` +
      `</div>`;

    $('quiz-count').textContent = 'Done';
    $('quiz-progress-fill').style.width = '100%';
    $('quiz-dots').innerHTML = '';

    if (res.score >= 70) { sound('complete'); confettiBurst(res.score === 100 ? 220 : 120); }
    else sound('wrong');
    if (xpGain > 0) addXp(xpGain, speedrun ? 'Quiz + speedrun' : 'Quiz bonus');

    $('quiz-back-lesson').addEventListener('click', () => go('lesson'));
    $('btn-retake-quiz').addEventListener('click', takeQuiz);
    if (state.wrongResults.length) {
      $('btn-review-mistakes').addEventListener('click', () => startMistakesReview(rebuildWrongQuestions()));
    }
    if (res.score < 70) $('btn-generate-review').addEventListener('click', generateReview);
  }

  async function generateReview() {
    if (!state.lesson) return;
    setButtonLoading('btn-generate-review', true, 'Creating review…');
    try {
      const res = await api('generateReview', { courseId: state.lesson.courseId, lessonId: state.lesson.lessonId, score: state.lastScore || 0 });
      const review = res.review;
      const html =
        `<div class="subcard review-card" style="margin-top:14px;">` +
        `<h2>🧩 Review</h2>` +
        `<h3>Simplified explanation</h3><div>${textHtml(review.simplifiedExplanation || '')}</div>` +
        `<h3>Review lesson</h3><div>${textHtml(review.reviewLesson || '')}</div>` +
        `<h3>Extra practice</h3>` +
        (review.practiceQuestions || []).map((pq, i) =>
          `<div class="practice-question">` +
          `<strong>${esc(String(i + 1) + '. ' + pq.prompt)}</strong>` +
          `<div class="small" style="margin-top:6px;"><strong>Answer:</strong> ${textHtml(pq.answer)}</div>` +
          `<div class="small muted" style="margin-top:4px;">${textHtml(pq.explanation || '')}</div>` +
          `</div>`
        ).join('') +
        `<div class="row"><button class="btn btn-primary" id="btn-start-practice" type="button">▶ Practice these interactively</button></div>` +
        `</div>`;
      const area = $('review-area');
      if (area) {
        area.innerHTML = html;
        $('btn-start-practice').addEventListener('click', () => startPracticeQuiz(review));
        area.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setButtonLoading('btn-generate-review', false);
    }
  }

  /* ---------- grading helpers ---------- */
  function normalizeShortLocal(s) {
    return String(s || '').toLowerCase().trim()
      .replace(/[.,!?;:'"()]/g, '')
      .replace(/\s+/g, ' ');
  }
  const normalizeOptionLocal = (s) => normalizeShortLocal(s);

  function normalizeBoolLocal(v) {
    if (v === true) return true;
    if (v === false) return false;
    const s = String(v).trim().toLowerCase();
    if (['true', 't', 'yes', 'y', '1'].indexOf(s) !== -1) return true;
    if (['false', 'f', 'no', 'n', '0'].indexOf(s) !== -1) return false;
    return false;
  }

  function resolveMcLocal(q, val) {
    const options = q.options || [];
    if (/^\d+$/.test(String(val).trim())) {
      const idx = Number(val);
      if (idx >= 0 && idx < options.length) return options[idx];
    }
    return String(val || '');
  }

  function gradeShortLocal(userNorm, answer) {
    if (!userNorm) return false;
    const alternatives = String(answer || '').split(/[|;]/);
    for (let i = 0; i < alternatives.length; i++) {
      const exp = normalizeShortLocal(alternatives[i]);
      if (!exp) continue;
      if (userNorm === exp) return true;
      if (exp.length > 4 && userNorm.length >= 4) {
        if (userNorm.indexOf(exp) !== -1 || exp.indexOf(userNorm) !== -1) return true;
      }
    }
    return false;
  }

  function gradeQuestionLocal(q, answer) {
    let correct = false;
    let correctAnswer = '';
    let userAnswer = answer;

    if (q.type === 'mc') {
      const userText = resolveMcLocal(q, answer);
      const correctText = resolveMcLocal(q, q.answer);
      const normCorrect = normalizeOptionLocal(correctText);
      correct = normCorrect !== '' && normalizeOptionLocal(userText) === normCorrect;
      correctAnswer = q.answer;
      userAnswer = userText;
    } else if (q.type === 'tf') {
      const userBool = normalizeBoolLocal(answer);
      const correctBool = normalizeBoolLocal(q.answer);
      correct = userBool === correctBool;
      correctAnswer = correctBool ? 'True' : 'False';
      userAnswer = userBool ? 'True' : 'False';
    } else {
      correct = gradeShortLocal(normalizeShortLocal(answer), q.answer);
      correctAnswer = q.answer;
    }

    return { correct, userAnswer, correctAnswer, explanation: q.explanation || '' };
  }

  /* ==========================================================
     20b. MISTAKES-ONLY REVIEW & INTERACTIVE PRACTICE
     ========================================================== */

  // Rebuild a mini quiz from the questions you got wrong, so you can drill them.
  function startMistakesReview(wrongList) {
    if (!wrongList || !wrongList.length || !state.lesson) return;
    state.quiz = { questions: wrongList.map((q) => Object.assign({}, q)) };
    state.practiceMode = true;
    state.quizIndex = 0;
    state.quizAnswers = wrongList.map(() => null);
    state.quizChecked = wrongList.map(() => false);
    state.quizLocalResults = wrongList.map(() => null);
    state.lastScore = null;
    state.quizStreakCount = 0;
    state.quizDone = false;
    state.quizSeconds = 0;
    state.quizStartedAt = Date.now();

    $('quiz-nav').classList.remove('hidden');
    $('quiz-streak').classList.add('hidden');
    startQuizTimer();
    renderQuizQuestion();
    go('mistakes');
    showToast(`🔁 Practicing ${wrongList.length} question${wrongList.length > 1 ? 's' : ''} you missed`, 'info', 2600);
  }

  function renderPracticeFinal(fixed, total) {
    stopQuizTimer();
    state.quizDone = true;
    $('quiz-nav').classList.add('hidden');
    $('quiz-feedback').classList.add('hidden');
    $('quiz-count').textContent = 'Done';
    $('quiz-progress-fill').style.width = '100%';
    $('quiz-dots').innerHTML = '';

    const perfect = fixed === total;
    $('quiz-slide').innerHTML =
      `<div class="slide-card quiz-final">` +
      `<div class="score-card">` +
      `<div class="score-number">${esc(String(fixed))}/${esc(String(total))}</div>` +
      `<div><strong>${perfect ? 'All mistakes fixed! 🤩' : 'Great practice session!'}</strong></div>` +
      `</div>` +
      `<p class="muted center small">This was a local practice round — your official score stays safe.</p>` +
      `<div class="row wrap center">` +
      `<button class="btn btn-secondary" id="practice-back-lesson" type="button">← Back to Lesson</button>` +
      `<button class="btn btn-primary" id="practice-retake" type="button">🔁 Practice again</button>` +
      `<button class="btn btn-secondary" id="practice-full-quiz" type="button">🧠 Retake full quiz</button>` +
      `</div></div>`;

    if (perfect) { confettiBurst(100); sound('complete'); }
    $('practice-back-lesson').addEventListener('click', () => go('lesson'));
    $('practice-retake').addEventListener('click', () => startMistakesReview(state.wrongResults.length ? rebuildWrongQuestions() : []));
    $('practice-full-quiz').addEventListener('click', takeQuiz);
  }

  // Keep an untouched copy of the wrong questions so "practice again" always
  // restarts from the original mistakes.
  function rebuildWrongQuestions() {
    return state.wrongResults.map((q) => Object.assign({}, q));
  }

  // Turn the AI review's practiceQuestions into a real interactive mini-quiz.
  function startPracticeQuiz(review) {
    if (!state.lesson) return;
    const qs = (review.practiceQuestions || []).map((pq, i) => {
      const type = ['mc', 'tf', 'short'].indexOf(pq.type) !== -1 ? pq.type : 'short';
      return {
        id: pq.id || ('pq' + (i + 1)),
        type,
        prompt: pq.prompt || 'Review question',
        options: type === 'mc' ? (pq.options || []) : undefined,
        answer: pq.answer || '',
        explanation: pq.explanation || ''
      };
    }).filter((q) => q.type !== 'mc' || q.options.length >= 2);
    if (!qs.length) { showToast('No practice questions available.', 'error'); return; }

    state.quiz = { questions: qs };
    state.practiceMode = true;
    state.quizIndex = 0;
    state.quizAnswers = qs.map(() => null);
    state.quizChecked = qs.map(() => false);
    state.quizLocalResults = qs.map(() => null);
    state.lastScore = null;
    state.quizStreakCount = 0;
    state.quizDone = false;
    state.quizSeconds = 0;
    state.quizStartedAt = Date.now();

    $('quiz-nav').classList.remove('hidden');
    $('quiz-streak').classList.add('hidden');
    startQuizTimer();
    renderQuizQuestion();
    go('mistakes');
    showToast('🧩 AI practice round — graded locally', 'info', 2600);
  }

  /* ==========================================================
     20c. NOTES BROWSER (all your notes in one place)
     ========================================================== */
  async function openNotesModal() {
    openModal('modal-notes');
    const list = $('notes-list');
    list.innerHTML = `<div class="empty">Loading your notes…</div>`;
    try {
      const res = await api('getNotes', {});
      const notes = (res.notes || []).filter((n) => String(n.content || '').trim() !== '');
      if (!notes.length) {
        list.innerHTML = `<div class="empty">No notes yet. Open any lesson — the ✍️ note slide autosaves whatever you write.</div>`;
        return;
      }
      list.innerHTML = notes.map((n) => {
        const info = lessonTitleInfo(n.lessonId);
        return `<div class="note-item">` +
          `<div class="note-item-head">` +
          `<strong>${esc(info.title || n.lessonId)}</strong>` +
          `<span class="muted tiny">${esc(relTime(n.updatedAt))}</span>` +
          `</div>` +
          `<div class="note-item-body">${textHtml(n.content)}</div>` +
          (info.courseId ? `<div class="row"><button class="btn btn-small btn-secondary note-open" type="button" data-lessonid="${esc(n.lessonId)}" data-courseid="${esc(info.courseId)}">Open lesson</button></div>` : '') +
          `</div>`;
      }).join('');
      $$('#notes-list .note-open').forEach((btn) => {
        btn.addEventListener('click', () => {
          closeModal('modal-notes');
          const lessonId = btn.getAttribute('data-lessonid');
          const courseId = btn.getAttribute('data-courseid');
          const m = String(lessonId).match(/_m(\d+)_l(\d+)$/);
          openLesson(courseId, m ? Number(m[1]) : 0, m ? Number(m[2]) : 0, lessonId);
        });
      });
    } catch (err) {
      list.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  /* ==========================================================
     21. VIEW BINDINGS (lesson / quiz navigation)
     ========================================================== */
  function bindLesson() {
    $('btn-lesson-back').addEventListener('click', () => {
      if (state.course && state.course.courseId) go('course', state.course.courseId);
      else go('dashboard');
    });
    $('btn-slide-prev').addEventListener('click', prevSlide);
    $('btn-slide-next').addEventListener('click', nextSlide);
    $('btn-complete-lesson').addEventListener('click', completeLesson);
    $('btn-take-quiz').addEventListener('click', takeQuiz);
    $('btn-flashcards').addEventListener('click', startFlashcards);
    $('btn-next-lesson').addEventListener('click', () => {
      if (state.lesson && state.lesson.courseId) openNextLesson(state.lesson.courseId);
    });
    $('btn-copy-lesson-link').addEventListener('click', async () => {
      if (!state.lesson) return;
      const base = location.href.split('#')[0];
      const url = `${base}#/lesson/${encodeURIComponent(state.lesson.lessonId)}`;
      const ok = await copyText(url);
      showToast(ok ? 'Lesson link copied 🔗' : 'Could not copy — clipboard blocked.', ok ? 'success' : 'error');
    });

    const slides = $('lesson-slides');
    slides.addEventListener('touchstart', (e) => {
      state.touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    slides.addEventListener('touchend', (e) => {
      if (e.target.closest('input, textarea, select, button, label')) return;
      const dx = e.changedTouches[0].clientX - state.touchStartX;
      if (dx < -50) nextSlide();
      if (dx > 50) prevSlide();
    }, { passive: true });
  }

  function bindQuiz() {
    $('btn-quiz-back').addEventListener('click', () => {
      stopQuizTimer();
      if (state.lesson) go('lesson');
      else go('dashboard');
    });
    $('btn-quiz-check').addEventListener('click', checkCurrentQuestion);
    $('btn-quiz-next').addEventListener('click', continueQuiz);

    const quizSlide = $('quiz-slide');
    quizSlide.addEventListener('touchstart', (e) => {
      state.quizTouchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    quizSlide.addEventListener('touchend', (e) => {
      if (e.target.closest('input, textarea, select, button, label')) return;
      const dx = e.changedTouches[0].clientX - state.quizTouchStartX;
      if (dx > 50 && state.quizIndex > 0) {
        state.quizIndex--;
        renderQuizQuestion();
      }
      if (dx < -50 && state.quiz && state.quizChecked[state.quizIndex]) {
        continueQuiz();
      }
    }, { passive: true });
  }

  /* ==========================================================
     22. SETTINGS / DATA / MODALS
     ========================================================== */
  function bindSettings() {
    $$('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
    });
    $$('.modal-overlay').forEach((ov) => {
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(ov.id); });
    });

    $('set-sound').addEventListener('change', (e) => { settings.sound = e.target.checked; saveSettings(); if (settings.sound) sound('click'); });
    $('set-animations').addEventListener('change', (e) => { settings.animations = e.target.checked; saveSettings(); applySettings(); });
    $('set-bigfont').addEventListener('change', (e) => { settings.bigFont = e.target.checked; saveSettings(); applySettings(); });

    const goalInput = $('set-goal');
    if (goalInput) {
      goalInput.value = String(settings.dailyGoal || 3);
      goalInput.addEventListener('change', () => {
        const v = clamp(parseInt(goalInput.value, 10) || 3, 1, 20);
        goalInput.value = String(v);
        settings.dailyGoal = v;
        saveSettings();
        updateGoalPill();
        showToast(`🎯 Daily goal set to ${v} lesson${v > 1 ? 's' : ''}`);
      });
    }

    $('btn-export-data').addEventListener('click', () => {
      const data = {
        app: 'LearnJoy', version: APP_VERSION, exportedAt: new Date().toISOString(),
        settings, xp: xpGet(), bestScores: bestScores(), needsReview: lastQuizzes(),
        studyMinutes: Object.fromEntries(Object.entries(timeMap()).map(([k, v]) => [k, Math.round(v / 60)])),
        theme: lsGet('lj_theme')
      };
      downloadFile('learnjoy-data.json', JSON.stringify(data, null, 2), 'application/json');
      showToast('Data exported ⬇️', 'success');
    });

    $('btn-clear-cache').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Clear offline cache?', text: 'Saved copies of your dashboard, courses, lessons and quizzes will be removed from this browser.', okLabel: 'Clear', danger: true });
      if (!ok) return;
      clearCache();
      showToast('Offline cache cleared 🧹', 'success');
    });

    $('btn-reset-demo').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Reset demo data?', text: 'This deletes all demo accounts, courses and progress stored in this browser.', okLabel: 'Reset', danger: true });
      if (!ok) return;
      Demo.reset();
      if (Demo.active()) {
        clearAuth();
        showToast('Demo data reset ♻️');
      } else {
        showToast('Demo data reset ♻️');
      }
    });

    $('about-version').textContent = 'v' + APP_VERSION + (Demo.active() ? ' · demo mode' : '');
  }

  /* ==========================================================
     23. COMMAND PALETTE
     ========================================================== */
  let paletteItems = [];
  let paletteIndex = 0;

  function paletteCommands() {
    const cmds = [
      { icon: '🏠', label: 'Go to Dashboard', hint: 'G then D', keywords: 'home dash stats', run: () => go('dashboard') },
      { icon: '＋', label: 'Create a new course', hint: 'G then N', keywords: 'new generate create ai topic', run: () => go('new') },
      { icon: document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙', label: 'Toggle dark / light theme', hint: '', keywords: 'theme dark light mode', run: toggleTheme },
      { icon: '🔊', label: settings.sound ? 'Mute sound effects' : 'Unmute sound effects', hint: '', keywords: 'sound audio mute', run: () => { settings.sound = !settings.sound; saveSettings(); applySettings(); showToast(settings.sound ? 'Sound on 🔊' : 'Sound off 🔇'); } },
      { icon: '⚙️', label: 'Open settings', hint: '', keywords: 'settings preferences options', run: () => { updateXpPill(); openModal('modal-settings'); } },
      { icon: '⌨️', label: 'Keyboard shortcuts', hint: '?', keywords: 'keys help shortcuts', run: () => openModal('modal-shortcuts') }
    ];
    if (isAuthed()) {
      cmds.push(
        { icon: '✍️', label: 'Browse my notes', hint: '', keywords: 'notes writing journal', run: openNotesModal },
        { icon: '⏭', label: 'Next incomplete lesson', hint: 'N', keywords: 'next continue resume lesson', run: () => { const cid = (state.lesson && state.lesson.courseId) || (state.course && state.course.courseId) || (state.dashboard && state.dashboard.continueCourseId); if (cid) openNextLesson(cid); else showToast('No course selected yet.', 'error'); } },
        { icon: '🚪', label: 'Log out', hint: '', keywords: 'logout sign out exit', run: () => $('btn-logout').click() }
      );
    }
    if (state.dashboard && state.dashboard.courses) {
      state.dashboard.courses.forEach((c) => {
        cmds.push({ icon: '📚', label: `Open course: ${c.title}`, hint: `${c.progressPercent || 0}%`, keywords: 'course ' + String(c.title).toLowerCase(), run: () => go('course', c.courseId) });
      });
    }
    return cmds;
  }

  function openPalette() {
    paletteIndex = 0;
    $('palette-input').value = '';
    renderPalette();
    openModal('modal-palette');
    setTimeout(() => $('palette-input').focus(), 50);
  }

  function renderPalette() {
    const q = $('palette-input').value.trim().toLowerCase();
    paletteItems = paletteCommands().filter((c) => !q || (c.label + ' ' + (c.keywords || '')).toLowerCase().indexOf(q) !== -1).slice(0, 9);
    paletteIndex = clamp(paletteIndex, 0, Math.max(0, paletteItems.length - 1));
    const list = $('palette-list');
    if (!paletteItems.length) {
      list.innerHTML = `<div class="palette-empty">No matching commands 🤷</div>`;
      return;
    }
    list.innerHTML = paletteItems.map((c, i) =>
      `<div class="palette-item${i === paletteIndex ? ' active' : ''}" role="option" data-i="${i}">` +
      `<span class="p-icon">${c.icon}</span><span>${esc(c.label)}</span>` +
      (c.hint ? `<span class="p-hint">${esc(c.hint)}</span>` : '') + `</div>`
    ).join('');
    $$('#palette-list .palette-item').forEach((el) => {
      el.addEventListener('click', () => runPalette(Number(el.getAttribute('data-i'))));
      el.addEventListener('mousemove', () => {
        paletteIndex = Number(el.getAttribute('data-i'));
        $$('#palette-list .palette-item').forEach((x, xi) => x.classList.toggle('active', xi === paletteIndex));
      });
    });
  }

  function runPalette(i) {
    const cmd = paletteItems[i];
    if (!cmd) return;
    closeModal('modal-palette');
    cmd.run();
  }

  function bindPalette() {
    $('palette-input').addEventListener('input', () => { paletteIndex = 0; renderPalette(); });
    $('palette-input').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, paletteItems.length - 1); renderPalette(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); renderPalette(); }
      else if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); }
    });
  }

  /* ==========================================================
     24. GLOBAL KEYBOARD SHORTCUTS
     ========================================================== */
  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function bindGlobalKeys() {
    document.addEventListener('keydown', (e) => {
      // Command palette works everywhere
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if ($('modal-palette').classList.contains('hidden')) openPalette();
        else closeModal('modal-palette');
        return;
      }

      // Escape closes overlays
      if (e.key === 'Escape') {
        if (closeTopModal()) return;
        return;
      }

      if (isTyping(e)) return;

      // Palette navigation when open is handled on the input itself
      if (!$('modal-palette').classList.contains('hidden')) return;

      if (e.key === '?') { e.preventDefault(); openModal('modal-shortcuts'); return; }

      const view = currentView();

      if (view === 'lesson') {
        if (e.key === 'ArrowRight') { e.preventDefault(); nextSlide(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); prevSlide(); }
        if (e.key === 'q' || e.key === 'Q') takeQuiz();
        if (e.key === 'f' || e.key === 'F') startFlashcards();
        if (e.key === 't' || e.key === 'T') $('tutor-toggle').click();
        if (e.key === 'n' || e.key === 'N') { if (state.lesson && state.lesson.courseId) openNextLesson(state.lesson.courseId); }
      }

      if (view === 'course' && (e.key === 'n' || e.key === 'N')) {
        if (state.course && state.course.courseId) openNextLesson(state.course.courseId);
      }

      if (view === 'quiz' && state.quiz) {
        const q = state.quiz.questions[state.quizIndex];
        if (!q) return;
        if (!state.quizChecked[state.quizIndex]) {
          if (q.type === 'mc' && /^[1-9]$/.test(e.key)) {
            const idx = Number(e.key) - 1;
            const radios = $$('input[name="quiz-option"]');
            if (radios[idx]) { radios[idx].checked = true; radios[idx].dispatchEvent(new Event('change', { bubbles: true })); }
          }
          if (q.type === 'tf') {
            if (e.key === 't' || e.key === 'T') selectQuizRadio('true');
            if (e.key === 'f' || e.key === 'F') selectQuizRadio('false');
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          continueQuiz();
        }
        if (e.key === 'Enter' && !state.quizChecked[state.quizIndex] && hasCurrentAnswer() && q.type !== 'short') {
          e.preventDefault();
          checkCurrentQuestion();
        }
      }

      if (view === 'flashcards' && state.flash && state.flash.deck && state.flash.deck.length) {
        if (e.key === ' ') { e.preventDefault(); flipFlash(); }
        if (e.key === '1') gradeFlash(false);
        if (e.key === '2') gradeFlash(true);
      }
    });
  }

  function selectQuizRadio(value) {
    const radios = $$('input[name="quiz-option"]');
    const target = radios.find((r) => r.value === value);
    if (target) { target.checked = true; target.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  /* ==========================================================
     25. STUDY-TIME TRACKER
     ========================================================== */
  function startStudyTracker() {
    setInterval(() => {
      if (!isAuthed()) return;
      if (document.visibilityState !== 'visible') return;
      const v = currentView();
      if (v === 'lesson' || v === 'quiz' || v === 'flashcards') addStudySeconds(30);
    }, 30000);
  }

  /* ==========================================================
     26. BACKEND CONFIG CHECK
     ========================================================== */
  async function loadConfig() {
    const note = $('auth-backend-note');
    if (DEMO_ONLY) {
      Demo.enable();
      note.textContent = 'No backend configured — running in demo mode. Everything stays in your browser.';
      return;
    }
    try {
      const res = await api('getConfig', {}, { noAuth: true });
      if (res && res.allowRegister === false) {
        $('tab-register').classList.add('hidden');
        setAuthMode('login');
      }
      note.textContent = '';
    } catch (e) {
      note.textContent = 'Backend unreachable right now — you can still explore the demo below.';
    }
  }

  /* ==========================================================
     27. INIT
     ========================================================== */
  function init() {
    // Views are focus targets for a11y announcements
    $$('.view').forEach((v) => { if (!v.hasAttribute('tabindex')) v.setAttribute('tabindex', '-1'); });

    initTheme();
    applySettings();
    bindTopbar();
    bindAuth();
    bindGenerate();
    bindLesson();
    bindTutor();
    bindQuiz();
    bindFlash();
    bindSettings();
    bindPalette();
    bindGlobalKeys();
    startStudyTracker();
    updateNetPill();

    $('btn-course-back').addEventListener('click', () => go('dashboard'));
    $('course-search').addEventListener('input', filterCourses);

    // Restore remembered username
    const remembered = lsGet('lj_remember_user');
    if (remembered) $('auth-username').value = remembered;

    // Warm up audio context on first interaction (browser policy)
    document.addEventListener('pointerdown', function warm() {
      if (settings.sound) { try { sound('click'); } catch (e) { /* noop */ } }
      document.removeEventListener('pointerdown', warm);
    }, { once: true });

    loadConfig();

    // Progressive-app polish: cache the shell for full offline launches.
    // Skipped in test harnesses (window.NO_SW) and unsupported contexts.
    if ('serviceWorker' in navigator && !window.NO_SW) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
      });
    }

    // Restore session
    const token = lsGet('lj_token');
    if (token) {
      const savedUser = jsonGet('lj_user', null);
      if (savedUser) {
        state.user = savedUser;
        updateTopbar(savedUser, savedUser.streak || 0);
      }
      if (!location.hash) location.hash = '#/dashboard';
      window.addEventListener('hashchange', handleRoute);
      handleRoute();
    } else {
      if (!location.hash || location.hash !== '#/login') location.hash = '#/login';
      window.addEventListener('hashchange', handleRoute);
      handleRoute();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
