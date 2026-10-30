/* Original Canvas2D helix. No framework, shaders or third-party carousel code. */
const TAU = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const mod = (n, size) => ((n % size) + size) % size;
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrappedLines(ctx, text, maxWidth, maximum = 3) {
  const words = String(text || 'Projekt').trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  if (lines.length > maximum) {
    lines.length = maximum;
    let tail = lines[maximum - 1];
    while (tail.length && ctx.measureText(`${tail}…`).width > maxWidth) tail = tail.slice(0, -1);
    lines[maximum - 1] = `${tail}…`;
  }
  return lines;
}

export class SpiralFlux {
  constructor(canvas, { projects = [], onSelect, onFocus, reducedMotion = false } = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('SpiralFlux requires a canvas.');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!this.ctx) throw new Error('Canvas2D is unavailable.');
    this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
    this.onFocus = typeof onFocus === 'function' ? onFocus : () => {};
    this.projects = [];
    this.position = 0;
    this.target = 0;
    this.velocity = 0;
    this.paused = false;
    this._explicitReduced = Boolean(reducedMotion);
    this._destroyed = false;
    this._visible = true;
    this._raf = null;
    this._lastTime = 0;
    this._drag = null;
    this._focusId = null;
    this._hitAreas = [];
    this._textures = new Map();
    this._images = new Map();
    this._listeners = [];
    this._interactionUntil = 0;
    this._wheelTimer = null;
    this._lastReducedWheel = 0;
    this._originalTouchAction = canvas.style.touchAction;
    this._originalCursor = canvas.style.cursor;
    this._originalTabIndex = canvas.getAttribute('tabindex');
    if (canvas.tabIndex < 0) canvas.tabIndex = 0;
    if (!canvas.style.touchAction) canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';
    this._motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this._explicitReduced || Boolean(this._motionQuery?.matches);
    this._tick = this._tick.bind(this);

    this._listen(canvas, 'pointerdown', (e) => this._pointerDown(e));
    this._listen(canvas, 'pointermove', (e) => this._pointerMove(e), { passive: false });
    this._listen(canvas, 'pointerup', (e) => this._pointerEnd(e, false));
    this._listen(canvas, 'pointercancel', (e) => this._pointerEnd(e, true));
    this._listen(canvas, 'lostpointercapture', (e) => this._pointerEnd(e, true));
    this._listen(canvas, 'wheel', (e) => this._wheel(e), { passive: false });
    this._listen(canvas, 'keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      this.step(['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1);
    });
    this._listen(document, 'visibilitychange', () => {
      if (document.hidden) this._stopFrame();
      else { this._lastTime = 0; this._requestFrame(); }
    });
    if (this._motionQuery) {
      const changed = () => {
        this.reducedMotion = this._explicitReduced || this._motionQuery.matches;
        if (this.reducedMotion) {
          this.position = Math.round(this.position);
          this.target = this.position;
          this.velocity = 0;
        }
        this._lastTime = 0;
        this._requestFrame();
      };
      if (this._motionQuery.addEventListener) this._listen(this._motionQuery, 'change', changed);
      else {
        this._motionQuery.addListener(changed);
        this._legacyMotionListener = changed;
      }
    }
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(canvas);
    } else this._listen(window, 'resize', () => this._resize(), { passive: true });
    if (typeof IntersectionObserver !== 'undefined') {
      this._intersectionObserver = new IntersectionObserver((entries) => {
        this._visible = entries.some((entry) => entry.isIntersecting);
        if (!this._visible) this._stopFrame();
        else { this._lastTime = 0; this._requestFrame(); }
      }, { rootMargin: '40px' });
      this._intersectionObserver.observe(canvas);
    }
    this._resize();
    this.setProjects(projects);
    document.fonts?.ready.then(() => {
      if (!this._destroyed) { this._textures.clear(); this._requestFrame(); }
    });
  }

  _listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this._listeners.push(() => target.removeEventListener(type, listener, options));
  }

  _resize() {
    if (this._destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const width = Math.round(this.width * this.dpr), height = Math.round(this.height * this.dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.radius = clamp(this.width * 0.3, 105, 240);
    this.cardWidth = clamp(this.width * 0.34, 166, 238);
    this.cardHeight = this.cardWidth * 0.65;
    this.rise = clamp(this.height * 0.076, 34, 54);
    this.angleStep = 0.9;
    this.camera = this.radius * 5.2;
    this._requestFrame();
  }

  setProjects(projects) {
    if (this._destroyed) return;
    const previous = this._focusId;
    this.projects = Array.isArray(projects) ? projects.filter((p) => p && p.id != null).slice() : [];
    const found = this.projects.findIndex((p) => p.id === previous);
    this.position = found >= 0 ? found : 0;
    this.target = this.position;
    this.velocity = 0;
    this._focusId = null;
    this._textures.clear();
    this._interactionUntil = performance.now() + 650;
    this._notifyFocus();
    this._requestFrame();
  }

  step(direction = 1) {
    if (this._destroyed || this.projects.length < 2) return;
    const amount = Math.sign(Number(direction) || 1);
    this._interact();
    this.target = Math.round(this.target) + amount;
    this.velocity *= 0.3;
    if (this.reducedMotion) {
      this.position = this.target;
      this.velocity = 0;
      this._notifyFocus();
    }
    this._requestFrame();
  }

  togglePause() {
    if (this._destroyed) return this.paused;
    this.paused = !this.paused;
    if (this.paused) {
      this.target = this.position;
      this.velocity = 0;
    }
    this._lastTime = 0;
    this._requestFrame();
    return this.paused;
  }

  _interact() {
    this._interactionUntil = performance.now() + 7000;
    window.clearTimeout(this._wheelTimer);
    this._wheelTimer = null;
  }

  _pointerDown(event) {
    if (event.button !== 0 || !this.projects.length || this._drag) return;
    this.canvas.focus({ preventScroll: true });
    this._interact();
    this.target = this.position;
    this.velocity = 0;
    this._drag = {
      id: event.pointerId, type: event.pointerType, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, time: performance.now(), velocity: 0, moved: false,
    };
    this.canvas.style.cursor = 'grabbing';
    try { this.canvas.setPointerCapture(event.pointerId); } catch { /* Pointer already released. */ }
  }

  _pointerMove(event) {
    const drag = this._drag;
    if (!drag || drag.id !== event.pointerId) return;
    const totalX = event.clientX - drag.startX, totalY = event.clientY - drag.startY;
    if (drag.type === 'touch' && !drag.moved && Math.abs(totalY) > 7 && Math.abs(totalY) > Math.abs(totalX) * 1.15) {
      this._pointerEnd(event, true);
      return; // Native vertical page scrolling remains available.
    }
    if (!drag.moved && Math.hypot(totalX, totalY) < 5) return;
    drag.moved = true;
    if (event.cancelable) event.preventDefault();
    const now = performance.now(), dt = clamp((now - drag.time) / 1000, 0.008, 0.08);
    const pixels = Math.max(70, this.width * 0.18);
    const change = -((event.clientX - drag.x) * 0.88 + (drag.type === 'touch' ? 0 : (event.clientY - drag.y) * 0.6)) / pixels;
    this.position += change;
    this.target = this.position;
    drag.velocity = clamp(drag.velocity * 0.55 + (change / dt) * 0.45, -7, 7);
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.time = now;
    this._notifyFocus();
    this._requestFrame();
  }

  _pointerEnd(event, canceled) {
    const drag = this._drag;
    if (!drag || drag.id !== event.pointerId) return;
    this._drag = null;
    this.canvas.style.cursor = 'grab';
    try { if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId); } catch { /* Detached canvas. */ }
    this._interact();
    if (drag.moved && !canceled) {
      const recent = performance.now() - drag.time < 100;
      this.velocity = this.reducedMotion ? 0 : recent ? drag.velocity : 0;
      this.target = Math.round(this.position + this.velocity * 0.2);
      if (this.reducedMotion) this.position = this.target;
    } else {
      this.target = Math.round(this.position);
      if (!canceled && !drag.moved) {
        const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
        const hit = this._hitAreas.slice().reverse().find((area) => insidePolygon(x, y, area.polygon));
        if (hit) {
          this.target = hit.virtualIndex;
          if (this.reducedMotion) this.position = this.target;
          this.onSelect(hit.project);
        }
      }
    }
    this._notifyFocus();
    this._requestFrame();
  }

  _wheel(event) {
    if (this.projects.length < 2) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const focused = document.activeElement === this.canvas;
    if (!horizontal && !event.shiftKey && !focused) return;
    const raw = horizontal ? event.deltaX : event.deltaY || event.deltaX;
    if (!raw) return;
    if (event.cancelable) event.preventDefault();
    this._interact();
    const now = performance.now();
    if (this.reducedMotion) {
      if (now - this._lastReducedWheel > 160) {
        this._lastReducedWheel = now;
        this.step(Math.sign(raw));
      }
      return;
    }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
    this.target += clamp(raw * unit / 150, -2.5, 2.5);
    this._wheelTimer = window.setTimeout(() => {
      if (!this._destroyed && !this._drag) {
        this.target = Math.round(this.target);
        this._requestFrame();
      }
    }, 170);
    this._requestFrame();
  }

  _notifyFocus() {
    if (!this.projects.length) return;
    const project = this.projects[mod(Math.round(this.position), this.projects.length)];
    if (project.id !== this._focusId) {
      this._focusId = project.id;
      this.onFocus(project);
    }
  }

  _requestFrame() {
    if (this._destroyed || this._raf !== null || !this._visible || document.hidden) return;
    this._raf = window.requestAnimationFrame(this._tick);
  }

  _stopFrame() {
    if (this._raf !== null) window.cancelAnimationFrame(this._raf);
    this._raf = null;
    this._lastTime = 0;
  }

  _tick(now) {
    this._raf = null;
    if (this._destroyed || !this._visible || document.hidden) return;
    const dt = this._lastTime ? Math.min((now - this._lastTime) / 1000, 0.032) : 1 / 60;
    this._lastTime = now;
    const auto = !this.reducedMotion && !this.paused && !this._drag && this.projects.length > 1 && now > this._interactionUntil;
    if (!this.reducedMotion && !this._drag) {
      if (auto) this.target += dt * 0.22;
      const acceleration = (this.target - this.position) * 110 - this.velocity * 18.5;
      this.velocity = clamp(this.velocity + acceleration * dt, -12, 12);
      this.position += this.velocity * dt;
      if (!auto && Math.abs(this.target - this.position) < 0.0005 && Math.abs(this.velocity) < 0.002) {
        this.position = this.target;
        this.velocity = 0;
      }
    }
    if (this.projects.length && Math.abs(this.position) > 10000) {
      const shift = Math.floor(this.position / this.projects.length) * this.projects.length;
      this.position -= shift;
      this.target -= shift;
    }
    this._draw();
    this._notifyFocus();
    const moving = !this.reducedMotion && !this._drag && (auto || Math.abs(this.velocity) > 0.002 || Math.abs(this.target - this.position) > 0.0005);
    if (moving) this._requestFrame();
    else {
      this._lastTime = 0;
      // Wake once after a user interaction; no idle rendering while paused.
      if (!this.reducedMotion && !this.paused && !this._drag && this.projects.length > 1 && now <= this._interactionUntil) {
        window.clearTimeout(this._resumeTimer);
        this._resumeTimer = window.setTimeout(() => this._requestFrame(), Math.max(20, this._interactionUntil - now + 5));
      }
    }
  }

  _project(x, y, z) {
    const tilt = -0.11;
    const yy = y * Math.cos(tilt) - z * Math.sin(tilt);
    const zz = y * Math.sin(tilt) + z * Math.cos(tilt);
    const scale = this.camera / Math.max(this.radius, this.camera - zz);
    return { x: this.width * 0.5 + x * scale, y: this.height * 0.48 + yy * scale, z: zz };
  }

  _surface(card, u, v) {
    const angle = card.angle + u / this.radius;
    return this._project(this.radius * Math.sin(angle), card.y + v, this.radius * Math.cos(angle));
  }

  _outline(card) {
    const polygon = [], halfW = this.cardWidth / 2, halfH = this.cardHeight / 2;
    for (let i = 0; i <= 12; i++) polygon.push(this._surface(card, -halfW + this.cardWidth * i / 12, -halfH));
    for (let i = 12; i >= 0; i--) polygon.push(this._surface(card, -halfW + this.cardWidth * i / 12, halfH));
    return polygon;
  }

  _cover(project) {
    if (!project.cover) return null;
    if (this._images.has(project.cover)) return this._images.get(project.cover).image;
    const entry = { image: null }, image = new Image();
    this._images.set(project.cover, entry);
    image.decoding = 'async';
    image.onload = () => {
      if (this._destroyed) return;
      entry.image = image;
      this._textures.clear();
      this._requestFrame();
    };
    image.onerror = () => { entry.image = null; };
    image.src = project.cover;
    entry.loader = image;
    return null;
  }

  _texture(project, index) {
    if (this._textures.has(project.id)) {
      const texture = this._textures.get(project.id);
      this._textures.delete(project.id);
      this._textures.set(project.id, texture);
      return texture;
    }
    const texture = document.createElement('canvas');
    texture.width = 432;
    texture.height = 280;
    const ctx = texture.getContext('2d'), cover = this._cover(project);
    const accent = project.accent || '#DDFD80';
    roundedRect(ctx, 0, 0, 432, 280, 14);
    ctx.clip();
    ctx.fillStyle = '#F0F1E8';
    ctx.fillRect(0, 0, 432, 280);
    if (cover?.naturalWidth) {
      const factor = Math.max(432 / cover.naturalWidth, 280 / cover.naturalHeight);
      const width = cover.naturalWidth * factor, height = cover.naturalHeight * factor;
      ctx.drawImage(cover, (432 - width) / 2, (280 - height) / 2, width, height);
      const shade = ctx.createLinearGradient(0, 0, 0, 280);
      shade.addColorStop(0, 'rgba(10,12,9,.2)');
      shade.addColorStop(0.42, 'rgba(10,12,9,.06)');
      shade.addColorStop(1, 'rgba(10,12,9,.88)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, 432, 280);
    } else {
      // An original typographic card, never a fabricated screenshot or metric.
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.72;
      ctx.fillRect(0, 0, 432, 280);
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = '#101510';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(373, 30, 85 + i * 34, 72 + i * 26, -0.5, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const ink = cover ? '#FAFBF2' : '#11150F';
    ctx.fillStyle = ink;
    ctx.font = '500 14px Arial, sans-serif';
    ctx.fillText(String(project.categoryLabel || 'PROJEKT').toLocaleUpperCase('cs-CZ').slice(0, 35), 25, 34);
    ctx.font = '500 13px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(index + 1).padStart(2, '0'), 405, 34);
    ctx.textAlign = 'left';
    ctx.font = '600 38px Arial, sans-serif';
    const lines = wrappedLines(ctx, project.name, 365, 3);
    const start = 237 - (lines.length - 1) * 42;
    lines.forEach((line, i) => ctx.fillText(line, 25, start + i * 42));
    this._textures.set(project.id, texture);
    while (this._textures.size > 32) this._textures.delete(this._textures.keys().next().value);
    return texture;
  }

  _drawStrip(texture, x, width, points) {
    const [p0, p1, p2, p3] = points;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
    ctx.closePath(); ctx.clip();
    ctx.transform((p1.x - p0.x) / width, (p1.y - p0.y) / width,
      (p3.x - p0.x) / texture.height, (p3.y - p0.y) / texture.height, p0.x, p0.y);
    ctx.drawImage(texture, x, 0, Math.min(width + 0.9, texture.width - x), texture.height,
      0, 0, width + 0.9, texture.height);
    ctx.restore();
  }

  _drawCard(card) {
    const ctx = this.ctx, texture = this._texture(card.project, card.index);
    const front = Math.cos(card.angle), center = this._surface(card, 0, 0);
    const fade = 1 - smoothstep(this.height * 0.36, this.height * 0.64, Math.abs(center.y - this.height * 0.48));
    const alpha = fade * (front >= 0 ? 0.36 + front * 0.64 : 0.13 + (1 + front) * 0.09);
    if (alpha < 0.015) return;
    const slices = this.width < 480 ? 14 : 20;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < slices; i++) {
      const left = -this.cardWidth / 2 + this.cardWidth * i / slices;
      const right = left + this.cardWidth / slices;
      this._drawStrip(texture, texture.width * i / slices, texture.width / slices, [
        this._surface(card, left, -this.cardHeight / 2), this._surface(card, right, -this.cardHeight / 2),
        this._surface(card, right, this.cardHeight / 2), this._surface(card, left, this.cardHeight / 2),
      ]);
    }
    const polygon = this._outline(card);
    ctx.beginPath();
    polygon.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = Math.abs(card.offset) < 0.55 ? '#DDFD80' : 'rgba(235,239,226,.22)';
    ctx.lineWidth = Math.abs(card.offset) < 0.55 ? 1.5 : 0.6;
    ctx.stroke();
    const flare = Math.pow(1 - Math.min(1, Math.abs(front) / 0.34), 2);
    if (flare > 0.01) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = flare * fade * 0.3;
      ctx.strokeStyle = card.project.accent || '#DDFD80';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 15;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(center.x - 2, center.y - this.cardHeight * 0.8);
      ctx.lineTo(center.x + 2, center.y + this.cardHeight * 0.8);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    if (front > 0.08 && alpha > 0.2) this._hitAreas.push({ polygon, project: card.project, virtualIndex: card.virtualIndex });
  }

  _draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this._hitAreas = [];
    if (!this.projects.length) {
      ctx.fillStyle = 'rgba(239,242,228,.5)';
      ctx.font = '14px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Žádné projekty v tomto výběru', this.width / 2, this.height / 2);
      ctx.textAlign = 'left';
      return;
    }
    const half = Math.min(Math.ceil(this.height / this.rise / 2) + 2, Math.floor(this.projects.length / 2));
    const middle = Math.round(this.position), cards = [];
    for (let i = middle - half; i <= middle + half; i++) {
      // A short list renders each item once; the regular portfolio loops naturally.
      if (this.projects.length % 2 === 0 && cards.length === this.projects.length) break;
      const offset = i - this.position, index = mod(i, this.projects.length);
      cards.push({ virtualIndex: i, index, project: this.projects[index], offset,
        angle: offset * this.angleStep, y: offset * this.rise,
        depth: this._project(this.radius * Math.sin(offset * this.angleStep), offset * this.rise, this.radius * Math.cos(offset * this.angleStep)).z });
    }
    cards.sort((a, b) => a.depth - b.depth);
    for (const card of cards) this._drawCard(card);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._stopFrame();
    window.clearTimeout(this._wheelTimer);
    window.clearTimeout(this._resumeTimer);
    this._resizeObserver?.disconnect();
    this._intersectionObserver?.disconnect();
    this._listeners.splice(0).forEach((remove) => remove());
    if (this._legacyMotionListener) this._motionQuery.removeListener(this._legacyMotionListener);
    if (this._drag) {
      try { this.canvas.releasePointerCapture(this._drag.id); } catch { /* Pointer already released. */ }
    }
    this._drag = null;
    for (const entry of this._images.values()) if (entry.loader) entry.loader.onload = entry.loader.onerror = null;
    this._images.clear();
    this._textures.clear();
    this._hitAreas = [];
    this.canvas.style.touchAction = this._originalTouchAction;
    this.canvas.style.cursor = this._originalCursor;
    if (this._originalTabIndex === null) this.canvas.removeAttribute('tabindex');
    else this.canvas.setAttribute('tabindex', this._originalTabIndex);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
