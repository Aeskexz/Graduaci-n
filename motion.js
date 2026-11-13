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

const form = invitation.querySelector('.invitation-rsvp');
const status = invitation.querySelector('.registration-status');
const submit = form.querySelector('button');
const giftNote = invitation.querySelector('.gift-note');
let confirmation;

form.hidden = !form.hasAttribute('data-habilitado');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;

  const name = new FormData(form).get('nombre').trim();
  if (!name) {
    status.textContent = 'Recuerda poner tu nombre completo';
    form.elements.nombre.focus();
    return;
  }

  submit.disabled = true;
  status.textContent = 'Guardando tu confirmación…';
  if (confirmation?.name !== name) {
    confirmation = { name, id: crypto.randomUUID() };
  }

  try {
    const response = await fetch(form.action, {
      method: 'POST',
      credentials: 'omit',
      body: new URLSearchParams({ nombre: name, id: confirmation.id }),
    });
    if (response.status === 400) {
      status.textContent = 'Escribe un nombre válido de hasta 120 caracteres.';
      return;
    }
    if (response.status === 429) {
      status.textContent = 'Espera un momento antes de volver a confirmar.';
      return;
    }
    if (response.status !== 201 || (await response.json()).guardado !== true) {
      throw new Error('Confirmación sin respuesta válida');
    }

    form.hidden = true;
    status.classList.add('registration-confirmation');
    status.textContent = 'Muchas gracias, ¡te esperamos!';
    giftNote.hidden = false;
  } catch {
    status.textContent = 'No pudimos verificar tu confirmación. Vuelve a intentarlo.';
  } finally {
    submit.disabled = false;
  }
});
