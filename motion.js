const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

function createSpark() {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 48;
  const brush = sprite.getContext('2d');
  const glow = brush.createRadialGradient(24, 24, 0, 24, 24, 24);
  glow.addColorStop(0, '#fffae0');
  glow.addColorStop(.16, '#ffe09c');
  glow.addColorStop(.36, '#ffc35ba6');
  glow.addColorStop(.66, '#ec9b342c');
  glow.addColorStop(1, '#ec9b3400');
  brush.fillStyle = glow;
  brush.fillRect(0, 0, 48, 48);
  return sprite;
}

function setupParticles() {
  const canvas = document.querySelector('.particles');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const backdrop = document.createElement('canvas');
  const background = backdrop.getContext('2d');
  const sprite = createSpark();
  let width = 0;
  let height = 0;
  let scale = 1;
  let flakes = [];
  let frame;
  let lastTime;

  function spark(brush, x, y, size, opacity) {
    brush.globalAlpha = opacity;
    brush.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  function scatter(count, edge, depth) {
    for (let index = 0; index < count; index += 1) {
      const distance = Math.random() ** 2.45;
      const y = edge === 'top' ? distance * depth : height - distance * depth;
      const x = Math.random() * width;
      const size = 1.6 + Math.random() ** 3.6 * 8;
      const opacity = (.21 + Math.random() * .72) * (1 - distance * .75);

      spark(background, x, y, size, opacity);

      if (index % 107 === 0 && distance < .55) {
        spark(background, x, y, 26, opacity);
        background.globalAlpha = opacity * .68;
        background.fillStyle = '#ffe6aa';
        background.fillRect(x - .45, y - 4, .9, 8);
        background.fillRect(x - 4, y - .45, 8, .9);
      }
    }
  }

  function makeFlake(initial) {
    return {
      x: Math.random() * width,
      y: initial ? Math.random() ** 1.7 * height : -8 - Math.random() * 32,
      speed: 13 + Math.random() * 42,
      drift: Math.random() * 12 - 6,
      size: 2.4 + Math.random() ** 2.1 * 7.5,
      opacity: .28 + Math.random() * .63,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function draw(seconds, time) {
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(backdrop, 0, 0, width, height);

    for (const [index, flake] of flakes.entries()) {
      flake.y += flake.speed * seconds;
      flake.x += flake.drift * seconds;

      if (flake.y > height + 8) {
        flakes[index] = makeFlake(false);
        continue;
      }

      if (flake.x < -8) flake.x = width + 8;
      if (flake.x > width + 8) flake.x = -8;

      const flicker = .75 + .25 * Math.sin(time * .002 + flake.phase);
      spark(ctx, flake.x, flake.y, flake.size, flake.opacity * flicker);
    }
  }

  function tick(time) {
    const seconds = lastTime === undefined ? 0 : Math.min((time - lastTime) / 1000, .05);
    lastTime = time;
    draw(seconds, time);
    frame = requestAnimationFrame(tick);
  }

  function updateMotion() {
    cancelAnimationFrame(frame);
    lastTime = undefined;
    if (motionPreference.matches || document.hidden) {
      draw(0, 0);
    } else {
      frame = requestAnimationFrame(tick);
    }
  }

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = backdrop.width = Math.round(width * scale);
    canvas.height = backdrop.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    background.setTransform(scale, 0, 0, scale, 0, 0);
    scatter(Math.round(width * 2.7), 'top', Math.min(height * .48, 365));
    scatter(Math.round(width * 1.5), 'bottom', 154);
    flakes = Array.from({ length: Math.round(width * .33) }, () => makeFlake(true));
    updateMotion();
  }

  new ResizeObserver(resize).observe(canvas);
  motionPreference.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', updateMotion);
}

setupParticles();
