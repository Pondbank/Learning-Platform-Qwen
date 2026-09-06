# 🌱 LearnJoy v2.1.0 — Bite-sized AI Learning

LearnJoy turns **any topic** into bite-sized, AI-generated courses: short slide-based
lessons, practice exercises, quizzes, flashcards and an in-lesson AI tutor — with
streaks, XP, daily goals, achievements and a joyful Duolingo-style UI (light / dark / auto).

**100% GitHub Pages friendly:** pure static files, zero build step, **no npm anywhere**.
Tests run with plain `node`.

---

## 📁 Files

| File | Purpose |
|---|---|
| `index.html` | App shell: all views, modals, a11y attributes, SEO meta. **Edit `APP_CONFIG` here.** |
| `app.js` | The entire app: routing, API client, offline cache, demo backend, all features. |
| `styles.css` | Full design system: themes, glassmorphism, responsive, print, reduced-motion. |
| `sw.js` | Optional Service Worker: caches the app shell for full offline launches. |
| `tests/dom-shim.js` | Tiny dependency-free DOM shim so tests run with plain Node. |
| `tests/smoke.js` | End-to-end test of the whole user journey in **demo mode**. |
| `tests/real-mode.js` | End-to-end test of the **production API path** (exact Apps Script contract). |

## 🚀 Quick start

### Option A — Zero setup (demo mode)

Set `APP_CONFIG.API_URL` in `index.html` to `"demo"` (or leave it empty) and open
`index.html`. Everything — accounts, course generation, quizzes, tutor — runs locally
in the browser with a fully simulated AI backend.

### Option B — Your Google Apps Script backend (Code.gs)

1. Deploy your Apps Script web app (`Execute as: Me`, `Who has access: Anyone`).
2. Paste the `/exec` URL into `APP_CONFIG.API_URL` in `index.html`.
3. Push everything to GitHub Pages (or any static host). Done — no build step.

### GitHub Pages deploy

1. Put `index.html`, `app.js`, `styles.css`, `sw.js` at the repo root (or `/docs`).
2. Settings → Pages → Deploy from branch → root.
3. Hash-based routing means no 404 rewrite hacks are needed.

### Running the tests (no npm!)

```bash
node tests/smoke.js      # full demo-mode journey (~60 checks)
node tests/real-mode.js  # production API path vs a contract mock (~45 checks)
```

---

## ✨ Feature list

### Learning
- 🤖 **AI course generation** — topic + level + daily time + learning style
- 📘 **Slide-based lesson player** — intro, key points, examples, common mistakes,
  exercise with hint/solution, summary, note slide
- 🧠 **Quizzes** — exactly the backend format (2 MC + 1 TF + 2 short), instant local
  grading with explanations, question navigator dots, timer, correct-streak counter,
  keyboard answering (`1–9`, `T/F`, `Enter`)
- 🔍 **Review Mistakes** — drill just the questions you missed (local practice rounds
  that never touch your official score)
- 🧩 **AI Review → Interactive practice** — low scores unlock an AI review whose
  practice questions can be taken as a real interactive mini-quiz
- 🃏 **Flashcards** — auto-built per lesson, flip animation, shuffle, re-queue
- 💬 **AI tutor** — typing indicator, suggestion chips, error recovery
- ✍️ **Notes** — autosave per lesson **plus a Notes browser** that lists every note
  with its lesson title and a one-click "Open lesson"
- ⏭ **Next lesson** everywhere — dashboard, course cards, lesson toolbar, palette, `N` key
- 🔗 **Share links** — `#/lesson/<lessonId>` deep links open straight from a URL
  (uses the backend's `getLessonById` path), plus copy-link + copy-outline buttons
- 🔎 Course search, 🔁 retake quizzes, personal-best tracking

### Motivation
- 🔥 **Streaks** with a **streak-at-risk warning** when today is still empty
- 🎯 **Daily lesson goal** (configurable, pill in the top bar, celebration on hit)
- 🏆 **Achievements** — the full 7-badge backend collection shown locked/unlocked,
  with unlock celebrations when a new one lands
- ⚡ **XP & levels** — lesson +25, per correct answer +5, perfect quiz +20,
  **speedrun bonus +15** (perfect in ≤30 s), flashcards +10, practice +8, course +50
- 📊 **Dashboard** — 6 stats, quiz-score bar chart, recent scores, needs-review list
- 🎉 Confetti + WebAudio sound effects (toggleable, no audio assets)

### App quality
- 🌗 **Theme: light → dark → auto** (auto follows the OS live)
- ⌨️ Shortcuts + **Ctrl/⌘ K command palette**
- 📡 **Offline**: cached dashboard/courses/lessons/quizzes, offline banner,
  local quiz grading so effort is never lost, **Service Worker app shell**
- ⏱ **Hardened API client** — timeouts (30 s / 150 s for AI calls), retry for reads,
  friendly errors, rate-limit messages surfaced
- 🔒 **Security** — CSP-friendly (no inline handlers), every server string escaped,
  client-side validation mirrors the backend (username regex, 8+ char passwords)
- ♿ **Accessibility** — landmarks, labels, focus management, dialog roles, skip link,
  `aria-live`, `prefers-reduced-motion`, larger-text option
- 📱 Responsive + swipe gestures, 🖨 print styles, web manifest (data URI), `<noscript>`
- 🧪 Both full journeys covered by npm-free automated tests

---

## 🔌 Backend API contract (matches Code.gs)

The client POSTs `{ action, params, token }` as `text/plain` and expects
`{ success: true, ... }` or `{ success: false, error }`.

| Action | Params | Returns |
|---|---|---|
| `getConfig` | — | `{ allowRegister }` |
| `register` / `login` | `username, password, userAgent` | `{ user, session: { token } }` |
| `logout` | — | `{ loggedOut }` |
| `getDashboard` | — | `{ user, streak, completedLessons, averageScore, courses[], continueCourseId, recentScores[], achievements[] }` |
| `generateCourse` | `prompt, level, timeAvailable, learningStyle` | `{ course: { courseId } }` |
| `getCoursesByUser` / `getCourseById` | `[courseId]` | `{ courses[] }` / `{ course }` |
| `generateLesson` | `courseId, moduleIndex, lessonIndex` **or** `courseId, lessonId` | `{ lesson }` |
| `getLessonById` | same as above | `{ lesson }` |
| `generateQuiz` | `courseId, lessonId` | `{ quiz: { questions[5] } }` (q1..q5) |
| `submitQuiz` | `courseId, lessonId, answers[]` | `{ score, correct, total, results[], passed }` |
| `generateReview` | `lessonId, score` | `{ review }` (3 practice questions) |
| `askTutor` | `lessonId, question` | `{ answer }` |
| `markLessonComplete` | `courseId, lessonId` | `{ streak, totalLessons, courseCompleted, … }` |
| `getNotes` / `saveNote` | `lessonId[, content]` | `{ notes[] }` / `{ note }` |

Contract details the frontend honors:
- `lessonId` format is `courseId_m<module>_l<lesson>` (used for deep links, caches, review lists).
- Achievements are the 7 `ACHIEVEMENT_DEFS_` types; the dashboard merges them with
  locked states client-side.
- Validation mirrors the backend: username `/^[a-z0-9._-]{3,30}$/` (lowercased),
  password ≥ 8 chars — users get instant feedback before a round-trip.
- The client never calls actions the backend doesn't have.

---

## 🛠 What was fixed from the original code

The original repo contained **three mutually incompatible halves**:

1. `index.html` was structurally broken — `</head>` closed early, ~600 lines of CSS
   dumped raw inside `<body>` (rendered as page text), stray `</style>`, duplicate
   `<head>`/`<body>`, and a giant inline `<script>` implementing a *different* app.
2. `app.js` referenced ~30 DOM ids that didn't exist (`modal-tutor`, `loading-fill`,
   `modules-list`, `slide-content`, `form-login`, `login-email`, …) and spoke a
   **different backend contract** than the real Apps Script.
3. `styles.css` styled elements from neither HTML variant.

Also fixed: XSS risks (unescaped interpolation + inline `onclick`), missing
timeouts/retries/offline handling, zero accessibility, and no tests.

**Bugs caught by the new test suites during this rewrite** (all fixed):
- `showAuthError` referencing an out-of-scope variable (crashed login errors)
- cross-realm `instanceof TypeError` breaking network-error detection
- a note-autosave race where the async `getNotes` reply clobbered text the user
  had already typed
- deep links to a different lesson being swallowed by the in-memory lesson
- a `classList` handler bug in the first test harness (fixed in the shim)

---

## ⌨️ Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl/⌘ K` | Command palette |
| `← / →` | Lesson slides |
| `1–9` | Pick quiz option |
| `T / F` | True / False |
| `Enter` | Check / continue quiz |
| `Q / F / T` | Quiz / Flashcards / Tutor (on a lesson) |
| `N` | Next incomplete lesson |
| `Space` | Flip flashcard |
| `1 / 2` | Flashcard: still learning / got it |
| `?` | Shortcut help · `Esc` closes dialogs |

---

MIT-style "do whatever, learn joyfully" license. Made with 🌱
