(() => {
  const studies = document.querySelectorAll('.study-video');
  const loadPlayer = (study) => {
    const template = study.querySelector('.study-video-player template');
    if (template) template.replaceWith(template.content.cloneNode(true));
  };
  studies.forEach((study) => {
    study.addEventListener('toggle', () => { if (study.open) loadPlayer(study); });
  });
  let printState;
  window.addEventListener('beforeprint', () => {
    if (printState) return;
    printState = Array.from(studies, (study) => study.open);
    studies.forEach((study) => { study.open = true; });
  });
  window.addEventListener('afterprint', () => {
    if (!printState) return;
    studies.forEach((study, index) => { study.open = printState[index]; });
    printState = null;
  });

  const revealHash = () => {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch (_) { return; }
    if (!id) return;
    let target = document.getElementById(id);
    if (!target) return;
    if (target.classList.contains('study-anchor') && target.nextElementSibling?.matches('h2')) {
      target = target.nextElementSibling;
    }
    const study = target.closest('.study-video');
    if (study) {
      study.open = true;
      loadPlayer(study);
    }
    requestAnimationFrame(() => {
      const summary = study && study.querySelector('summary');
      const focusTarget = summary && summary.contains(target) ? summary : target;
      if (focusTarget !== summary) focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
      focusTarget.scrollIntoView({ block: 'start' });
    });
  };
  window.addEventListener('hashchange', revealHash);
  // Repeated clicks on the current hash must also reopen a collapsed study.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (link && link.hash === window.location.hash) revealHash();
  });
  revealHash();
})();
