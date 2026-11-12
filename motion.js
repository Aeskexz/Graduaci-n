const invitation = document.querySelector('.invitation');
const cover = invitation.querySelector('summary');
const guide = document.querySelector('#guia');
const guideHeading = document.querySelector('#guia-titulo');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

function showGuide(behavior) {
  guideHeading.focus({ preventScroll: true });
  guide.scrollIntoView({ behavior, block: 'start' });
}

cover.addEventListener('click', (event) => {
  if (!invitation.open) return;

  event.preventDefault();
  showGuide(motionPreference.matches ? 'instant' : 'smooth');
});

function openGuideFromHash() {
  if (window.location.hash !== '#guia') return;

  invitation.open = true;
  showGuide('instant');
}

window.addEventListener('hashchange', openGuideFromHash);
openGuideFromHash();
