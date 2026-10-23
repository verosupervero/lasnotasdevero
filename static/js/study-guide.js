import { STORAGE_KEY, emptyProgress, parseProgress, mergeProgress, updateProgress, progressCounts } from './study-progress.js';

import { serializeProgress } from './study-progress.js';

const platform = document.querySelector('#study-platform');
if (platform) initialize(platform);

function initialize(root) {
  const lessons = [...root.querySelectorAll('.study-lesson')];
  const selector = root.querySelector('#study-class-selector');
  const tools = root.querySelector('#study-tools');
  if (!lessons.length || !selector || !tools) return;
  const catalog = lessons.map((lesson) => ({ id: lesson.dataset.studyId, kind: lesson.dataset.kind }));
  const programmaticOpen = new WeakSet();
  let state = emptyProgress(), storageStatus = 'ready', current, clock = Date.now(), restoring = false;
  try {
    const loaded = parseProgress(localStorage.getItem(STORAGE_KEY));
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
    if (storageStatus === 'ready') {
      try {
        const latest = parseProgress(localStorage.getItem(STORAGE_KEY));
        if (latest.status === 'ready') state = mergeProgress(state, latest.state);
        else storageStatus = latest.status;
      } catch { storageStatus = 'denied'; }
    }
    clock = Math.max(Date.now(), clock + 1, (state.lastActivity?.updatedAt || 0) + 1);
    state = updateProgress(state, id, field, value, clock, question);
    if (field !== 'selected') state = updateProgress(state, id, 'selected', undefined, clock);
    if (storageStatus === 'ready') {
      try { localStorage.setItem(STORAGE_KEY, serializeProgress(state)); } catch { storageStatus = 'denied'; }
    }
    renderProgress();
  }
  function renderProgress() {
    const counts = progressCounts(state, catalog), planned = root.dataset.plannedVideos || '13';
    const overall = root.querySelector('#study-overall-progress');
    if (overall) { overall.max = counts.course.total || 1; overall.value = counts.course.complete; }
    const text = root.querySelector('#study-overall-text');
    if (text) text.textContent = `${counts.course.complete} de ${counts.course.total} clases publicadas completadas · ${planned} videos previstos. Complementario: ${counts.complement.complete}/${counts.complement.total}. Integración: ${counts.integration.complete}/${counts.integration.total}.`;
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
      if (item !== lesson) item.querySelectorAll('.study-video-player iframe').forEach((iframe) => iframe.remove());
    });
    const player = lesson.querySelector('.study-video-player');
    if (player && !player.querySelector('iframe')) {
      const template = player.querySelector('template');
      if (template) player.append(template.content.cloneNode(true));
    }
    selector.value = lesson.dataset.studyId;
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
  selector.replaceChildren(...lessons.map((lesson) => {
    const option = document.createElement('option');
    option.value = lesson.dataset.studyId;
    option.textContent = [lesson.dataset.label, lesson.dataset.title, lesson.dataset.passage].filter(Boolean).join(' · ');
    return option;
  }));
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
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    // Explicit removal/clear is intentional: do not resurrect a deleted profile.
    if (event.newValue === null) {
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
        const disk = parseProgress(localStorage.getItem(STORAGE_KEY));
        if (disk.status !== 'ready') storageStatus = disk.status;
        else {
          state = mergeProgress(state, disk.state);
          const merged = serializeProgress(state);
          if (merged !== serializeProgress(disk.state)) localStorage.setItem(STORAGE_KEY, merged);
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
}
