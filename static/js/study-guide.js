import { emptyProgress, parseProgress, mergeProgress, updateProgress, progressCounts } from './study-progress.js';

import { serializeProgress } from './study-progress.js';
import { initializeSync, progressStorageKey } from './study-sync.js';

const platform = document.querySelector('#study-platform');
if (platform) initialize(platform);

function initialize(root) {
  const lessons = [...root.querySelectorAll('.study-lesson')];
  const selector = root.querySelector('#study-class-selector');
  const tools = root.querySelector('#study-tools');
  if (!lessons.length || !selector || !tools) return;
  const catalog = lessons.map((lesson) => ({ id: lesson.dataset.studyId, kind: lesson.dataset.kind }));
  const navButtons = new Map();
  const navGroups = new Map();
  const lessonGroups = new Map();
  lessons.forEach((lesson) => {
    const block = lesson.dataset.block || 'Otros';
    if (!lessonGroups.has(block)) lessonGroups.set(block, []);
    lessonGroups.get(block).push(lesson);
  });
  const programmaticOpen = new WeakSet();
  const baseStorageKey = progressStorageKey(root.dataset.courseId || 'lucas');
  let activeStorageKey = baseStorageKey;
  let privateProfile = false;
  let profileVersion = 0;
  let progressPending = root.dataset.syncEnabled === 'true' && root.dataset.syncProvider === 'firebase';
  const subscribers = new Set();
  let state = emptyProgress(), storageStatus = 'ready', current, clock = Date.now(), restoring = false;
  try {
    const loaded = parseProgress(localStorage.getItem(activeStorageKey));
    state = loaded.state; storageStatus = loaded.status;
  } catch { storageStatus = 'denied'; }
  const savedPoint = (id) => state.classes[id]?.lastPoint?.value;
  const findLesson = (id) => lessons.find((lesson) => lesson.dataset.studyId === id);
  const pointFor = (lesson) => {
    const point = document.getElementById(savedPoint(lesson.dataset.studyId));
    return point && lesson.contains(point) ? point : null;
  };
  const announce = (message) => { const el = root.querySelector('#study-selection-status'); if (el) el.textContent = message; };
  function storageMessage() {
    const el = root.querySelector('#study-storage-message');
    if (!el) return;
    el.textContent = storageStatus === 'ready' ? 'Tu avance se guarda en este navegador.' : storageStatus === 'future' ? 'Hay un avance guardado en una versión más nueva. Se conserva intacto; los cambios de esta visita quedan solo en memoria.' : storageStatus === 'corrupt' ? 'No pudimos leer el avance guardado. Se conserva intacto; los cambios de esta visita quedan solo en memoria.' : 'El navegador no permite guardar el avance. Podés estudiar; los cambios de esta visita quedan solo en memoria.';
  }
  function save(id, field, value, question) {
    if (restoring) return;
    const before = structuredClone(state);
    if (!privateProfile && storageStatus === 'ready') {
      try {
        const latest = parseProgress(localStorage.getItem(activeStorageKey));
        if (latest.status === 'ready') state = mergeProgress(state, latest.state);
        else storageStatus = latest.status;
      } catch { storageStatus = 'denied'; }
    }
    clock = Math.max(Date.now(), clock + 1, (state.lastActivity?.updatedAt || 0) + 1);
    state = updateProgress(state, id, field, value, clock, question);
    if (field !== 'selected') state = updateProgress(state, id, 'selected', undefined, clock);
    if (!privateProfile && storageStatus === 'ready') {
      try { localStorage.setItem(activeStorageKey, serializeProgress(state)); } catch { storageStatus = 'denied'; }
    }
    renderProgress();
    subscribers.forEach((callback) => callback(before));
  }
  function renderProgress() {
    const counts = progressCounts(state, catalog), planned = root.dataset.plannedVideos || '13';
    const total = counts.course.total + counts.complement.total + counts.integration.total;
    const complete = counts.course.complete + counts.complement.complete + counts.integration.complete;
    const overall = root.querySelector('#study-overall-progress');
    if (overall) {
      overall.max = total || 1;
      overall.setAttribute('aria-busy', String(progressPending));
      if (progressPending) overall.removeAttribute('value');
      else overall.value = complete;
    }
    const text = root.querySelector('#study-overall-text');
    if (text) text.textContent = progressPending ? 'Recuperando tu avance…' : `${complete} de ${total} actividades publicadas completadas`;
    const source = root.querySelector('#study-progress-source');
    if (source) source.textContent = progressPending ? 'Comprobando tu cuenta…' : activeStorageKey === baseStorageKey ? 'Avance de este navegador' : 'Avance de tu cuenta';
    const plan = root.querySelector('#study-plan-text'), extras = root.querySelector('#study-extra-progress');
    if (plan) plan.textContent = `Serie principal: ${planned} videos previstos`;
    if (extras) extras.textContent = progressPending ? '' : `Clases: ${counts.course.complete}/${counts.course.total} · Complementos: ${counts.complement.complete}/${counts.complement.total} · Integración: ${counts.integration.complete}/${counts.integration.total}`;
    for (const lesson of lessons) {
      const data = state.classes[lesson.dataset.studyId], blocks = [...lesson.querySelectorAll('.study-question')];
      let completed = 0;
      blocks.forEach((block) => {
        const checked = data?.blocks[block.dataset.questionId]?.value === true;
        if (checked) completed++;
        const input = block.querySelector('[data-block-complete]');
        if (input) input.checked = checked;
      });
      const progress = lesson.querySelector('[data-class-progress]');
      if (progress) progress.textContent = `${completed} de ${blocks.length} bloques trabajados`;
      const button = lesson.querySelector('[data-complete-class]');
      if (button) {
        const done = data?.complete?.value === true;
        button.textContent = done ? 'Clase completada · Desmarcar' : 'Marcar clase como completada';
        button.setAttribute('aria-pressed', String(done));
      }
      const navigation = navButtons.get(lesson.dataset.studyId);
      if (navigation) {
        const done = data?.complete?.value === true;
        const started = completed > 0 || !!data?.lastActivity?.value;
        navigation.querySelector('.study-nav-status').textContent = done ? 'Completada' : started ? 'En curso' : 'Sin comenzar';
        navigation.dataset.status = done ? 'complete' : started ? 'started' : 'new';
      }
    }
    const activity = root.querySelector('#study-last-activity');
    if (activity) activity.textContent = state.lastActivity ? `Última actividad: ${new Date(state.lastActivity.value).toLocaleString('es-AR')}` : 'Todavía no registraste actividad.';
    const resume = root.querySelector('#study-resume');
    if (resume) resume.hidden = !findLesson(state.selected?.value);
    storageMessage();
  }
  function focusPoint(target) {
    if (!target) return;
    const details = target.closest('details');
    if (details && !details.open) { programmaticOpen.add(details); details.open = true; }
    const focus = target.matches('details') ? target.querySelector('summary') : target.closest('summary') || target;
    if (!focus) return;
    if (!focus.matches('summary,button,a,input,select')) focus.setAttribute('tabindex', '-1');
    requestAnimationFrame(() => { focus.focus({ preventScroll: true }); focus.scrollIntoView({ block: 'start' }); });
  }
  function selectLesson(lesson, { persist = false, focus = false, point } = {}) {
    if (!lesson) return;
    current = lesson;
    lessons.forEach((item) => {
      item.hidden = item !== lesson;
    });
    selector.value = lesson.dataset.studyId;
    navButtons.forEach((button, id) => {
      if (id === lesson.dataset.studyId) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    const navGroup = navGroups.get(lesson.dataset.block);
    if (navGroup) navGroup.open = true;
    const index = lessons.indexOf(lesson);
    const previous = root.querySelector('#study-prev'), next = root.querySelector('#study-next');
    if (previous) previous.disabled = index === 0;
    if (next) next.disabled = index === lessons.length - 1;
    if (persist) save(lesson.dataset.studyId, 'selected');
    announce(`${lesson.dataset.label || ''}: ${lesson.dataset.title || ''}`);
    if (focus) focusPoint(point || lesson.querySelector('h2'));
  }
  function hashTarget() {
    try { return document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { return null; }
  }
  function revealHash(persist = false) {
    const target = hashTarget();
    if (!target || !root.contains(target)) return false;
    const lesson = target.closest('.study-lesson');
    const remembered = lesson && target.matches('h2, .study-anchor') && pointFor(lesson);
    if (lesson) selectLesson(lesson, { persist, focus: true, point: remembered || target });
    else focusPoint(target);
    if (persist && lesson) save(lesson.dataset.studyId, 'lastPoint', target.id);
    return true;
  }
  const list = root.querySelector('#study-class-list');
  const shortTitles = {
    'video-1': '¿Por qué estudiar el Nuevo Testamento?',
    'video-2': '¿Por qué leer Lucas?',
    'video-3': 'El anuncio y nacimiento de Jesús',
    'censo-lucas-2': 'El censo de Lucas 2',
    'video-4': 'Comienzo del ministerio de Jesús',
    integracion: 'Integración de Lucas 1–4',
    'video-5': 'Autoridad, comunidad y conflicto',
    'video-6': 'De oyentes a seguidores de Jesús',
    'lucas-1-6-cierre-practico': 'Lucas 1–6: de estudiar el texto a vivirlo'
  };
  const pickerTitles = {
    'video-1': 'Video 1 · Introducción al NT',
    'video-2': 'Video 2 · Introducción a Lucas',
    'censo-lucas-2': 'Complemento · Censo de Lucas 2',
    integracion: 'Cierre · Lucas 1–4',
    'lucas-1-6-cierre-practico': 'Cierre práctico · Lucas 1–6'
  };
  selector.replaceChildren(...[...lessonGroups].map(([block, groupedLessons]) => {
    const group = document.createElement('optgroup');
    group.label = block;
    group.append(...groupedLessons.map((lesson) => {
      const option = document.createElement('option');
      option.value = lesson.dataset.studyId;
      option.textContent = pickerTitles[lesson.dataset.studyId] || [lesson.dataset.label, lesson.dataset.passage || shortTitles[lesson.dataset.studyId] || lesson.dataset.title].filter(Boolean).join(' · ');
      return option;
    }));
    return group;
  }));
  if (list) {
    list.replaceChildren(...[...lessonGroups].map(([block, groupedLessons]) => {
      const item = document.createElement('li');
      const group = document.createElement('details');
      const summary = document.createElement('summary');
      const groupList = document.createElement('ul');
      group.className = 'study-nav-group';
      group.open = false;
      summary.textContent = `${block} · ${groupedLessons.length} clases`;
      groupedLessons.forEach((lesson) => {
        const lessonItem = document.createElement('li'), button = document.createElement('button');
        button.type = 'button';
        button.dataset.studyNav = lesson.dataset.studyId;
        for (const [className, text] of [
          ['study-nav-label', lesson.dataset.label],
          ['study-nav-title', shortTitles[lesson.dataset.studyId] || lesson.dataset.title],
          ['study-nav-status', 'Sin comenzar']
        ]) {
          const span = document.createElement('span');
          span.className = className;
          span.textContent = text || '';
          button.append(span);
        }
        button.addEventListener('click', () => {
          selectLesson(lesson, { persist: true, focus: true });
          history.replaceState(null, '', `#${encodeURIComponent(lesson.dataset.studyId)}`);
        });
        navButtons.set(lesson.dataset.studyId, button);
        lessonItem.append(button);
        groupList.append(lessonItem);
      });
      navGroups.set(block, group);
      group.append(summary, groupList);
      item.append(group);
      return item;
    }));
    root.querySelector('#study-sidebar').hidden = false;
  }
  selector.addEventListener('change', () => {
    const lesson = findLesson(selector.value);
    selectLesson(lesson, { persist: true });
    history.replaceState(null, '', `#${encodeURIComponent(lesson.dataset.studyId)}`);
    const point = pointFor(lesson);
    if (point) focusPoint(point);
  });
  ['prev', 'next'].forEach((direction) => root.querySelector(`#study-${direction}`)?.addEventListener('click', () => {
    const lesson = lessons[lessons.indexOf(current) + (direction === 'prev' ? -1 : 1)];
    selectLesson(lesson, { persist: true, focus: true });
    if (lesson) history.replaceState(null, '', `#${encodeURIComponent(lesson.dataset.studyId)}`);
  }));
  root.querySelector('#study-resume')?.addEventListener('click', () => {
    const lesson = findLesson(state.selected?.value);
    if (lesson) {
      const point = pointFor(lesson);
      selectLesson(lesson, { persist: true, focus: true, point });
      history.replaceState(null, '', `#${encodeURIComponent(point?.id || lesson.dataset.studyId)}`);
    }
  });
  for (const lesson of lessons) {
    const id = lesson.dataset.studyId;
    lesson.querySelectorAll('[data-class-progress], [data-complete-class]').forEach((el) => { el.hidden = false; });
    lesson.querySelector('[data-complete-class]')?.addEventListener('click', () => {
      save(id, 'complete', state.classes[id]?.complete?.value !== true);
      announce(state.classes[id].complete.value ? 'Clase marcada como completada.' : 'Clase desmarcada.');
    });
    lesson.querySelectorAll('.study-question').forEach((block) => {
      const input = block.querySelector('[data-block-complete]');
      if (input) {
        input.hidden = false;
        const control = input.closest('label') || input.closest('.study-block-control');
        if (control) control.hidden = false;
        input.addEventListener('change', () => {
          save(id, 'block', input.checked, block.dataset.questionId);
          save(id, 'lastPoint', block.id || block.querySelector('[id]')?.id || id);
        });
      }
      block.addEventListener('toggle', () => {
        if (programmaticOpen.has(block)) { programmaticOpen.delete(block); return; }
        if (block.open && lesson === current && !restoring) save(id, 'lastPoint', block.id || block.querySelector('[id]')?.id || id);
      });
    });
  }
  window.addEventListener('hashchange', () => revealHash(true));
  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (link && link.hash === location.hash) { event.preventDefault(); revealHash(true); }
  });
  window.addEventListener('storage', (event) => {
    // Private records have an atomic UID/epoch and a single writer per page.
    // Their notifications are handled by the coordinator, never as anonymous v1.
    if (privateProfile) return;
    if (event.key !== activeStorageKey && event.key !== null) return;
    // Explicit removal/clear is intentional: do not resurrect a deleted profile.
    if (event.newValue === null) {
      profileVersion++;
      state = emptyProgress();
      storageStatus = 'ready';
      renderProgress();
      return;
    }
    const incoming = parseProgress(event.newValue);
    if (incoming.status === 'ready') state = mergeProgress(state, incoming.state);
    else storageStatus = incoming.status;
    if (storageStatus === 'ready') {
      try {
        const disk = parseProgress(localStorage.getItem(activeStorageKey));
        if (disk.status !== 'ready') storageStatus = disk.status;
        else {
          state = mergeProgress(state, disk.state);
          const merged = serializeProgress(state);
          if (merged !== serializeProgress(disk.state)) localStorage.setItem(activeStorageKey, merged);
        }
      } catch { storageStatus = 'denied'; }
    }
    renderProgress();
  });
  let printState;
  window.addEventListener('beforeprint', () => {
    if (printState) return;
    restoring = true;
    printState = [...root.querySelectorAll('details')].map((el) => [el, el.open]);
    lessons.forEach((lesson) => { lesson.hidden = false; });
    printState.forEach(([el]) => { el.open = true; });
  });
  window.addEventListener('afterprint', () => {
    if (!printState) return;
    printState.forEach(([el, open]) => { el.open = open; });
    lessons.forEach((lesson) => { lesson.hidden = lesson !== current; });
    printState = undefined;
    setTimeout(() => { restoring = false; }, 0);
  });
  selectLesson(findLesson(state.selected?.value) || lessons[0]);
  tools.hidden = false;
  const pagination = root.querySelector('#study-pagination');
  if (pagination) {
    root.querySelector('.study-resource')?.before(pagination);
    pagination.hidden = false;
  }
  renderProgress();
  if (!revealHash()) {
    const point = pointFor(current);
    if (point) focusPoint(point);
  }
  root.classList.add('study-enhanced');
  const controller = {
    snapshot: () => structuredClone(state),
    get profileVersion() { return profileVersion; },
    canPersist: () => storageStatus === 'ready',
    subscribe: (callback) => subscribers.add(callback),
    setProgressPending(value) { progressPending = value; renderProgress(); },
    setPrivatePersisted(value) { storageStatus = value ? 'ready' : 'denied'; storageMessage(); },
    activate(key, next, options = {}) {
      if (key !== activeStorageKey || options.boundary) profileVersion++;
      progressPending = false;
      activeStorageKey = key;
      privateProfile = options.private === true;
      state = next;
      storageStatus = 'ready';
      try {
        if (!privateProfile) {
        storageStatus = parseProgress(localStorage.getItem(activeStorageKey)).status;
        if (storageStatus === 'ready') localStorage.setItem(activeStorageKey, serializeProgress(state));
        }
      } catch { storageStatus = 'denied'; }
      renderProgress();
      selectLesson(findLesson(state.selected?.value) || lessons[0]);
    },
    replace(next, reset = false) {
      const before = structuredClone(state);
      if (reset && !privateProfile) { try { localStorage.removeItem(activeStorageKey); } catch { /* Memory-only reset. */ } }
      if (reset) profileVersion++;
      this.activate(activeStorageKey, next, { private: privateProfile });
      subscribers.forEach((callback) => callback(before));
    }
  };
  initializeSync(root, controller, lessons.map((lesson) => ({
    id: lesson.dataset.studyId,
    questions: [...lesson.querySelectorAll('.study-question')].map((question) => question.dataset.questionId),
    points: [lesson.dataset.studyId, ...[...lesson.querySelectorAll('[id]')].map((element) => element.id)]
  })));
}
