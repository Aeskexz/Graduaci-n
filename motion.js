const invitation = document.querySelector('.invitation');
const cover = invitation.querySelector('summary');
const guideHeading = document.querySelector('#guia');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

function showGuide(behavior) {
  guideHeading.focus({ preventScroll: true });
  guideHeading.scrollIntoView({ behavior, block: 'start' });
}

cover.addEventListener('click', (event) => {
  if (!invitation.open) return;

  event.preventDefault();
  showGuide(motionPreference.matches ? 'instant' : 'smooth');
});

if (window.location.hash === '#guia') {
  invitation.open = true;
  showGuide('instant');
}
