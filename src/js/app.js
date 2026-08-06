/**
 * LearnJoy - Main Application JavaScript
 * A bite-sized AI learning platform
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    API_URL: "https://script.google.com/macros/s/AKfycbzwZlSVkPmMbI5a_QdHPJh1W5n2ATnTG03oSvH90KT8dUEqmb52ymbbcTu064Vlc61SIA/exec"
  };

  // Application State
  const state = {
    user: null,
    dashboard: null,
    course: null,
    lesson: null,
    slides: [],
    slideIndex: 0,
    noteContent: '',
    exerciseAttempts: {},
    exerciseRevealed: {},
    quiz: null,
    quizIndex: 0,
    quizAnswers: [],
    quizChecked: [],
    quizLocalResults: [],
    quizResults: null,
    lastScore: null,
    review: null,
    touchStartX: 0,
    quizTouchStartX: 0
  };

  // Utility Functions
  const $ = (id) => document.getElementById(id);

  const parseJson = (value, fallback) => {
    try { return JSON.parse(value); } catch (e) { return fallback; }
  };

  const lsGet = (key) => {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  };

  const lsSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch (e) {}
  };

  const lsDel = (key) => {
    try { localStorage.removeItem(key); } catch (e) {}
  };

  const esc = (v) => {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
  };

  const textHtml = (v) => esc(v).replace(/\n/g, '<br>');

  const emptyBox = (text) => `<div class="empty">${esc(text)}</div>`;

  const fmtDate = (s) => {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  // API Handler
  async function api(action, params = {}, noAuth = false) {
    if (!CONFIG.API_URL || String(CONFIG.API_URL).indexOf('PASTE_YOUR') !== -1) {
      throw new Error('Set CONFIG.API_URL in index.html to your Apps Script /exec URL.');
    }

    const token = noAuth ? '' : (lsGet('lj_token') || '');

    try {
      const response = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, params: params || {}, token })
      });

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.error('Unexpected API response:', CONFIG.API_URL, text && text.slice(0, 300));
        throw new Error('Backend returned an unexpected response. Check API_URL ends with /exec and access = Anyone.');
      }

      if (!data || data.success === false) {
        throw new Error((data && data.error) || 'Request failed');
      }

      return data;
    } catch (err) {
      if (err instanceof TypeError) {
        console.error('API fetch failed. API URL:', CONFIG.API_URL);
        throw new Error('Cannot reach backend: check API_URL ends with /exec and access = Anyone.');
      }
      throw err;
    }
  }

  // View Management
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const el = $('view-' + name);
    if (el) el.classList.remove('hidden');

    if (name === 'lesson' || name === 'quiz') {
      document.body.classList.add('focus');
    } else {
      document.body.classList.remove('focus');
    }

    if (!$('modal-tutor').classList.contains('hidden')) {
      closeTutorModal();
    }

    window.scrollTo(0, 0);
  }

  // Loading State Management
  let loadingShowTimer = null;
  let loadingTipTimer = null;
  let loadingTipInterval = null;
  let loadingProgressInterval = null;

  function showLoading(text = 'Loading...', sub = '', tips = [], progress = false) {
    clearTimeout(loadingShowTimer);
    clearTimeout(loadingTipTimer);
    clearInterval(loadingTipInterval);
    clearInterval(loadingProgressInterval);

    $('loading-text').textContent = text;
    $('loading-sub').textContent = sub;
    $('loading-tip').textContent = '';

    const fill = $('loading-fill');
    fill.classList.remove('indeterminate');
    fill.style.width = '0%';

    loadingShowTimer = setTimeout(() => {
      $('loading').classList.add('show');
      document.body.classList.add('busy');
    }, 140);

    if (progress) {
      let pct = 7;
      fill.style.width = pct + '%';
      loadingProgressInterval = setInterval(() => {
        if (pct < 82) pct += Math.random() * 9 + 3;
        else if (pct < 94) pct += Math.random() * 2 + 0.4;
        if (pct > 95) pct = 95;
        fill.style.width = Math.floor(pct) + '%';
      }, 620);
    } else {
      fill.classList.add('indeterminate');
    }

    loadingTipTimer = setTimeout(() => {
      const list = tips && tips.length ? tips : ['Almost there...'];
      let i = 0;
      $('loading-tip').textContent = list[i];
      loadingTipInterval = setInterval(() => {
        i = (i + 1) % list.length;
        $('loading-tip').textContent = list[i];
      }, 1550);
    }, 950);
  }

  function hideLoading() {
    clearTimeout(loadingShowTimer);
    clearTimeout(loadingTipTimer);
    clearInterval(loadingTipInterval);

    const fill = $('loading-fill');

    if (loadingProgressInterval) {
      clearInterval(loadingProgressInterval);
      loadingProgressInterval = null;
      fill.classList.remove('indeterminate');
      fill.style.width = '100%';
      setTimeout(() => {
        $('loading').classList.remove('show');
        document.body.classList.remove('busy');
      }, 180);
    } else {
      $('loading').classList.remove('show');
      document.body.classList.remove('busy');
    }
  }

  // Toast Notifications
  let toastTimer = null;

  function showToast(message, type = '') {
    const t = $('toast');
    t.textContent = message;
    t.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.className = 'toast';
    }, 4200);
  }

  // Skeleton Loading
  function skeletonBlock(height, radius) {
    return `<div class="skeleton" style="height:${height}px;border-radius:${radius}px;"></div>`;
  }

  function skeletonLines(count, heights) {
    return Array.from({ length: count }, (_, i) =>
      `<div class="skeleton" style="height:${heights[i] || 16}px;margin:${i > 0 ? 8 : 0}px 0;"></div>`
    ).join('');
  }

  function renderDashboardSkeleton() {
    $('stats-grid').innerHTML = [1, 2, 3, 4].map(() =>
      `<div class="stat-card">${skeletonBlock(42, 12)}${skeletonLines(2, [14, 14])}</div>`
    ).join('');

    $('achievements-grid').innerHTML = [1, 2, 3, 4].map(() =>
      `<div class="badge-card">${skeletonBlock(38, 12)}${skeletonLines(2, [14, 12])}</div>`
    ).join('');

    $('courses-grid').innerHTML = [1, 2, 3].map(() =>
      `<div class="course-card">${skeletonBlock(140, 18)}${skeletonLines(3, [18, 14, 14])}</div>`
    ).join('');
  }

  function renderCourseSkeleton() {
    const modules = Array.from({ length: 4 }, (_, i) => `
      <div class="card-row">
        <div class="lesson-main">
          ${skeletonBlock(42, 15)}
          <div>${skeletonLines(2, [16, 12])}</div>
        </div>
        ${skeletonBlock(32, 10)}
      </div>
    `).join('');

    $('modules-list').innerHTML = modules;
  }

  function renderLessonSkeleton() {
    $('player-title').textContent = '';
    $('slide-content').innerHTML = `
      ${skeletonBlock(76, 26)}
      ${skeletonBlock(24, 12)}
      ${skeletonLines(6, [18, 18, 18, 18, 18, 18])}
    `;
  }

  function renderQuizSkeleton() {
    $('quiz-question-number').textContent = '';
    $('quiz-question-text').innerHTML = skeletonLines(3, [20, 20, 18]);
    $('quiz-options').innerHTML = [1, 2, 3, 4].map(() =>
      `<div class="option">${skeletonBlock(24, 12)}</div>`
    ).join('');
  }

  // Theme Management
  function initTheme() {
    const saved = lsGet('lj_theme') || 'light';
    setTheme(saved);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    lsSet('lj_theme', theme);
    document.querySelectorAll('.js-theme').forEach(btn => {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    });
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Authentication
  function clearAuth() {
    lsDel('lj_token');
    lsDel('lj_user');
    state.user = null;
  }

  function afterAuth(user, dashboard) {
    state.user = user;
    state.dashboard = dashboard;
    lsSet('lj_user', JSON.stringify(user));
    updateTopbar(user, user.streak || 0);
    showView('dashboard');
    renderDashboard(dashboard);
    hideLoading();
  }

  function updateTopbar(user, streak) {
    $('user-name').textContent = user.name || 'User';
    $('user-streak').textContent = '🔥 ' + streak;
  }

  // Dashboard Rendering
  function renderDashboard(dashboard) {
    const { stats, achievements, courses } = dashboard;

    $('stats-grid').innerHTML = [
      { label: 'Streak', value: '🔥 ' + (stats.streak || 0) },
      { label: 'Lessons', value: stats.lessonsCompleted || 0 },
      { label: 'XP', value: (stats.xp || 0) + ' XP' },
      { label: 'Courses', value: stats.coursesEnrolled || 0 }
    ].map(s => `
      <div class="stat-card">
        <div class="stat-value">${s.value}</div>
        <div class="muted small">${s.label}</div>
      </div>
    `).join('');

    $('achievements-grid').innerHTML = (achievements && achievements.length ? achievements : [])
      .map(a => `
        <div class="badge-card">
          <div class="badge-icon">${a.icon || '🏆'}</div>
          <div class="badge-name">${esc(a.name || 'Achievement')}</div>
          <div class="tiny muted">${esc(a.description || '')}</div>
        </div>
      `).join('');

    $('courses-grid').innerHTML = (courses && courses.length ? courses : [])
      .map(c => `
        <div class="course-card" onclick="selectCourse('${c.id}')">
          <div style="font-size:3.5rem;margin-bottom:10px;">${c.coverEmoji || '📚'}</div>
          <h3>${esc(c.title || 'Course')}</h3>
          <p class="small muted">${esc(c.description || '')}</p>
          <div class="row wrap tiny muted">
            <span>${c.lessonsCount || 0} lessons</span>
            <span>•</span>
            <span>${c.enrolled || 0} enrolled</span>
          </div>
        </div>
      `).join('');
  }

  // Course Selection
  window.selectCourse = async function(courseId) {
    showLoading('Loading course...', '', ['Preparing modules...', 'Ready to learn!'], true);
    try {
      const res = await api('getCourse', { courseId });
      state.course = res.course;
      renderCourse(res.course);
      showView('course');
      hideLoading();
    } catch (err) {
      hideLoading();
      showToast(err.message, 'error');
    }
  };

  function renderCourse(course) {
    $('course-title').textContent = course.title || 'Course';
    $('course-description').textContent = course.description || '';
    renderCourseModules(course.modules || []);
  }

  function renderCourseModules(modules) {
    $('modules-list').innerHTML = modules.map((mod, mi) => `
      <div class="module">
        <h3 class="muted small">MODULE ${mi + 1}</h3>
        ${(mod.lessons || []).map((lesson, li) => `
          <div class="card-row" onclick="startLesson(${mi}, ${li})">
            <div class="lesson-main">
              <div class="lesson-icon">${lesson.icon || '📖'}</div>
              <div>
                <div class="lesson-title">${esc(lesson.title || 'Lesson')}</div>
                <div class="tiny muted">${lesson.duration || '5 min'} • ${lesson.type || 'Lesson'}</div>
              </div>
            </div>
            <div class="badge">${lesson.completed ? '✓' : 'Start'}</div>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  // Lesson Management
  window.startLesson = function(moduleIndex, lessonIndex) {
    const module = state.course.modules[moduleIndex];
    const lesson = module.lessons[lessonIndex];
    state.lesson = lesson;
    state.slides = lesson.slides || [];
    state.slideIndex = 0;

    $('player-title').textContent = lesson.title || 'Lesson';
    $('player-count').textContent = `${state.slideIndex + 1}/${state.slides.length}`;

    renderSlide();
    showView('lesson');
  };

  function renderSlide() {
    const slide = state.slides[state.slideIndex];
    if (!slide) return;

    $('slide-content').innerHTML = `
      <div class="slide-emoji">${slide.emoji || '📝'}</div>
      <div class="slide-kicker">${esc(slide.kicker || 'Learn')}</div>
      <div class="slide-body">${textHtml(slide.content || '')}</div>
      ${slide.callout ? `<div class="callout">${textHtml(slide.callout)}</div>` : ''}
      ${slide.chips && slide.chips.length ? `
        <div class="chips">${slide.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      ` : ''}
    `;

    $('player-count').textContent = `${state.slideIndex + 1}/${state.slides.length}`;
    $('btn-prev-slide').disabled = state.slideIndex === 0;
    $('btn-next-slide').textContent = state.slideIndex === state.slides.length - 1 ? 'Finish' : 'Next';
  }

  function prevSlide() {
    if (state.slideIndex > 0) {
      state.slideIndex--;
      renderSlide();
    }
  }

  function nextSlide() {
    if (state.slideIndex < state.slides.length - 1) {
      state.slideIndex++;
      renderSlide();
    } else {
      finishLesson();
    }
  }

  async function finishLesson() {
    showLoading('Completing lesson...', '', ['Great job!', 'Updating progress...'], true);
    try {
      const res = await api('completeLesson', {
        courseId: state.course.id,
        lessonId: state.lesson.id
      });
      hideLoading();
      showToast('Lesson completed! 🎉', 'success');
      showView('course');
    } catch (err) {
      hideLoading();
      showToast(err.message, 'error');
    }
  }

  // Quiz Management
  function startQuiz(quiz) {
    state.quiz = quiz;
    state.quizIndex = 0;
    state.quizAnswers = (quiz.questions || []).map(() => null);
    state.quizChecked = (quiz.questions || []).map(() => false);
    state.quizLocalResults = (quiz.questions || []).map(() => null);

    $('quiz-title').textContent = quiz.title || 'Quiz';
    renderQuizQuestion();
    showView('quiz');
  }

  function renderQuizQuestion() {
    const q = state.quiz.questions[state.quizIndex];
    if (!q) return;

    $('quiz-question-number').textContent = `Question ${state.quizIndex + 1}/${state.quiz.questions.length}`;
    $('quiz-question-text').textContent = q.text || '';

    const optionsHtml = q.options ? q.options.map((opt, oi) => `
      <label class="option" id="opt-${oi}">
        <input type="radio" name="quiz-answer" value="${oi}" ${state.quizAnswers[state.quizIndex] === oi ? 'checked' : ''}>
        <span>${esc(opt)}</span>
      </label>
    `).join('') : '';

    const shortHtml = q.type === 'short' ? `
      <textarea id="short-answer" placeholder="Type your answer here...">${state.quizAnswers[state.quizIndex] || ''}</textarea>
    ` : '';

    $('quiz-options').innerHTML = optionsHtml + shortHtml;

    // Bind events
    if (q.type === 'short') {
      $('short-answer').addEventListener('input', () => {
        state.quizAnswers[state.quizIndex] = $('short-answer').value;
      });
    } else {
      document.querySelectorAll('input[name="quiz-answer"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          state.quizAnswers[state.quizIndex] = parseInt(e.target.value);
          document.querySelectorAll('.option').forEach(el => el.classList.remove('selected'));
          e.target.closest('.option').classList.add('selected');
        });
      });
    }
  }

  function hasCurrentAnswer() {
    const q = state.quiz.questions[state.quizIndex];
    if (q.type === 'short') {
      return String(state.quizAnswers[state.quizIndex] || '').trim().length > 0;
    }
    return state.quizAnswers[state.quizIndex] !== null;
  }

  function checkCurrentQuestion() {
    const result = gradeQuestionLocal(
      state.quiz.questions[state.quizIndex],
      state.quizAnswers[state.quizIndex]
    );
    state.quizLocalResults[state.quizIndex] = result;
    state.quizChecked[state.quizIndex] = true;
    showQuizFeedback(result);
  }

  function showQuizFeedback(result) {
    const feedback = result.correct ?
      '<div class="quiz-feedback" style="background:rgba(88,204,2,0.15);border-color:var(--primary);">✓ Correct!</div>' :
      '<div class="quiz-feedback" style="background:var(--danger-soft);border-color:var(--danger);">✗ Incorrect</div>';

    $('quiz-options').insertAdjacentHTML('afterend', feedback);
  }

  function continueQuiz() {
    if (state.quizIndex < state.quiz.questions.length - 1) {
      state.quizIndex++;
      renderQuizQuestion();
    } else {
      finishQuiz();
    }
  }

  async function finishQuiz() {
    showLoading('Submitting quiz...', '', ['Calculating score...', 'Almost done...'], true);

    try {
      const answers = state.quiz.questions.map((q, i) => ({
        questionId: q.id,
        answer: state.quizAnswers[i],
        correct: state.quizLocalResults[i]?.correct || false
      }));

      const res = await api('submitQuiz', {
        quizId: state.quiz.id,
        courseId: state.course?.id,
        answers
      });

      hideLoading();
      renderQuizFinal(res);
    } catch (err) {
      hideLoading();
      showToast(err.message, 'error');
    }
  }

  function renderQuizFinal(res) {
    const { score, total, passed } = res;
    $('quiz-score').textContent = `${score}/${total}`;
    $('quiz-passed').textContent = passed ? 'Passed! 🎉' : 'Keep practicing!';
    $('quiz-passed').style.color = passed ? 'var(--primary)' : 'var(--muted)';

    showView('quiz-results');
  }

  // Tutor Modal
  function bindTutorModal() {
    $('btn-tutor-close')?.addEventListener('click', closeTutorModal);
    $('tutor-backdrop')?.addEventListener('click', closeTutorModal);
    $('btn-tutor-send')?.addEventListener('click', sendTutor);
    $('tutor-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendTutor();
    });
  }

  function openTutorModal() {
    if (!state.lesson) return;
    $('modal-tutor').classList.remove('hidden');
    document.body.classList.add('modal-open');
    setTimeout(() => { $('tutor-input')?.focus(); }, 80);
  }

  function closeTutorModal() {
    $('modal-tutor').classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  // Event Bindings
  function bindTopbar() {
    document.querySelectorAll('.js-theme').forEach(btn => {
      btn.addEventListener('click', toggleTheme);
    });
  }

  function bindLogin() {
    $('form-login')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('login-email')?.value || '';
      const password = $('login-password')?.value || '';

      if (!email || !password) {
        showToast('Please enter email and password', 'error');
        return;
      }

      showLoading('Signing in...', '', ['Verifying credentials...'], true);

      try {
        const res = await api('login', { email, password });
        lsSet('lj_token', res.token);
        afterAuth(res.user, res.dashboard);
      } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
      }
    });
  }

  function bindGenerate() {
    $('form-generate')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const topic = $('generate-topic')?.value || '';
      const level = $('generate-level')?.value || 'beginner';

      if (!topic.trim()) {
        showToast('Please enter a topic', 'error');
        return;
      }

      showLoading('Generating course...', '', [
        'Analyzing topic...',
        'Creating lessons...',
        'Preparing quiz...'
      ], true);

      try {
        const res = await api('generateCourse', { topic, level });
        lsSet('lj_token', res.token);
        afterAuth(res.user, res.dashboard);
      } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
      }
    });
  }

  function bindCourse() {
    $('btn-course-back')?.addEventListener('click', () => {
      showView('dashboard');
    });
  }

  function bindLesson() {
    $('btn-prev-slide')?.addEventListener('click', prevSlide);
    $('btn-next-slide')?.addEventListener('click', nextSlide);

    // Touch gestures for slide navigation
    const slideArea = $('slide-content');
    if (slideArea) {
      slideArea.addEventListener('touchstart', (e) => {
        state.touchStartX = e.touches[0].clientX;
      }, { passive: true });

      slideArea.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const diff = state.touchStartX - touchEndX;

        if (Math.abs(diff) > 50) {
          if (diff > 0) nextSlide();
          else prevSlide();
        }
      }, { passive: true });
    }
  }

  function bindQuiz() {
    $('btn-quiz-back')?.addEventListener('click', () => {
      showView('lesson');
    });

    const quizSlide = $('quiz-slide');
    if (quizSlide) {
      quizSlide.addEventListener('touchstart', (e) => {
        state.quizTouchStartX = e.touches[0].clientX;
      }, { passive: true });

      quizSlide.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const diff = state.quizTouchStartX - touchEndX;

        if (Math.abs(diff) > 50 && diff > 0) {
          if (hasCurrentAnswer()) continueQuiz();
        }
      }, { passive: true });
    }
  }

  // Grading Functions
  function normalizeShortLocal(s) {
    return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function normalizeOptionLocal(s) {
    return String(s || '').toLowerCase().trim();
  }

  function normalizeBoolLocal(v) {
    if (typeof v === 'boolean') return v;
    const s = String(v || '').toLowerCase().trim();
    return s === 'true' || s === 'yes' || s === '1';
  }

  function resolveMcLocal(q, val) {
    if (val === null || val === undefined) return null;
    const idx = typeof val === 'number' ? val : parseInt(val);
    if (isNaN(idx)) return null;
    return q.options && q.options[idx] !== undefined ? normalizeOptionLocal(q.options[idx]) : null;
  }

  function gradeShortLocal(userNorm, answer) {
    if (!userNorm || !answer) return false;
    const ansNorm = normalizeShortLocal(answer);

    if (userNorm === ansNorm) return true;

    const userWords = userNorm.split(' ');
    const ansWords = ansNorm.split(' ');

    const matches = userWords.filter(w => ansWords.includes(w));
    return matches.length >= Math.ceil(ansWords.length * 0.6);
  }

  function gradeQuestionLocal(q, answer) {
    let correct = false;
    let userAnswer = answer;
    let correctAnswer = q.answer;

    switch (q.type) {
      case 'short':
        correct = gradeShortLocal(normalizeShortLocal(answer), q.answer);
        break;
      case 'mc':
        userAnswer = resolveMcLocal(q, answer);
        correctAnswer = normalizeOptionLocal(q.answer);
        correct = userAnswer === correctAnswer;
        break;
      case 'bool':
        correct = normalizeBoolLocal(answer) === normalizeBoolLocal(q.answer);
        break;
      default:
        correct = false;
    }

    return {
      correct,
      userAnswer,
      correctAnswer,
      explanation: q.explanation || ''
    };
  }

  // Load Config
  async function loadConfig() {
    // Placeholder for future config loading
  }

  // Initialize Application
  function init() {
    initTheme();
    bindTopbar();
    bindLogin();
    bindGenerate();
    bindCourse();
    bindLesson();
    bindQuiz();
    bindTutorModal();
    loadConfig();

    const token = lsGet('lj_token');
    if (token) {
      const savedUser = parseJson(lsGet('lj_user'), null);
      if (savedUser) {
        state.user = savedUser;
        updateTopbar(savedUser, savedUser.streak || 0);
      }
      showView('dashboard');
      renderDashboardSkeleton();
      api('getDashboard')
        .then(afterAuth)
        .catch((err) => {
          clearAuth();
          showView('login');
          hideLoading();
          showToast(err.message, 'error');
        });
    } else {
      showView('login');
    }
  }

  // Expose global functions needed by HTML
  window.selectCourse = selectCourse;
  window.startLesson = startLesson;
  window.openTutorModal = openTutorModal;
  window.closeTutorModal = closeTutorModal;
  window.prevSlide = prevSlide;
  window.nextSlide = nextSlide;

  // Start the application when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
