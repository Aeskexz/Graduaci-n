const invitation = document.querySelector('.invitation');
const cover = invitation.querySelector('summary');
const guide = invitation.querySelector('.guide');
const guideHeading = document.querySelector('#guia-titulo');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

function resetCover() {
  invitation.open = false;
  invitation.classList.remove('guide-revealed');
}

invitation.classList.add('interactive');
resetCover();

cover.addEventListener('click', (event) => {
  if (!invitation.open) return;

  event.preventDefault();
  invitation.classList.add('guide-revealed');
  guideHeading.focus({ preventScroll: true });
  guide.scrollIntoView({ behavior: motionPreference.matches ? 'instant' : 'smooth', block: 'start' });
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) resetCover();
});
