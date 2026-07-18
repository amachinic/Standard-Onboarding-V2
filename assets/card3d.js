// Maison 3D card — renders a card-studio config as a real WebGL card with PBR
// (metalness / clearcoat / iridescence) so the holographic finish reacts to light,
// the mouse, and the device gyroscope. Falls back to nothing if WebGL is unavailable;
// the caller keeps the flat PNG as the fallback layer.
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/three/RoomEnvironment.js';

// standard credit-card proportions (1.586), thin slab
const CARD_W = 3.37, CARD_H = 2.125, CARD_T = 0.07, CORNER = 0.17;

function roundedRectShape(w, h, r){
  const s = new THREE.Shape(), x = -w/2, y = -h/2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

class Card3D {
  constructor(container, cfg){
    this.container = container;
    this.cfg = cfg || {};
    this.c = this.cfg.config || {};
    this.st = this.cfg.studio || {};
    this.rx = this.ry = this.tRX = this.tRY = 0;
    this._t0 = (window.performance && performance.now()) ? performance.now() : 0;
    this._init();
  }

  _init(){
    const w = this.container.clientWidth || 280;
    const h = this.container.clientHeight || 176;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.78;   // darker overall — not blown out by light
    this.renderer = renderer;

    const canvas = renderer.domElement;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:inherit;pointer-events:none';
    this.container.appendChild(canvas);
    this.canvas = canvas;

    const scene = new THREE.Scene();
    this.scene = scene;

    // image-based environment so the metal/holo has something to reflect
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment(renderer);
    this.envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = this.envRT.texture;
    pmrem.dispose();
    if (envScene.dispose) envScene.dispose();

    const cam = new THREE.PerspectiveCamera(22, w / h, 0.1, 100);
    this.camera = cam;

    const group = new THREE.Group();
    scene.add(group);
    this.group = group;

    const shape = roundedRectShape(CARD_W, CARD_H, CORNER);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: CARD_T, bevelEnabled: false, steps: 1, curveSegments: 28   // no metallic edge highlight
    });
    geo.center();
    this._planarUV(geo);

    const m = this.c.material || {};
    const material = new THREE.MeshPhysicalMaterial({
      map: this._loadAlbedo(this.c.albedo || 'assets/cards/card-7.png'),
      metalness: m.metalness != null ? m.metalness : 0.72,
      roughness: m.roughness != null ? m.roughness : 0.27,
      clearcoat: m.clearcoat != null ? m.clearcoat : 1,
      clearcoatRoughness: 0.16,
      iridescence: m.iridescence != null ? m.iridescence : 0.63,
      iridescenceIOR: 1.34,
      iridescenceThicknessRange: [120, 420],
      envMapIntensity: 0.66            // calmer reflections — keeps metallic contrast so text/detail stay readable
    });
    this.material = material;

    const mesh = new THREE.Mesh(geo, material);
    group.add(mesh);
    this.mesh = mesh;

    // key light per studio config
    const keyI = (this.st.lighting && this.st.lighting.key != null) ? this.st.lighting.key : 1.2;
    const kd = this.st.keyDir || { x: 0.1, y: 0.04 };
    const key = new THREE.DirectionalLight(0xffffff, keyI * 0.82);
    key.position.set(kd.x * 6 + 1.4, kd.y * 6 + 3.2, 6);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.38));   // softer fill so edges/shadows aren't harsh-black

    this._fitCamera(w / h);
    this._bindInput();   // hover / drag / gyro tilt interaction (idle float stays off)

    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    // the container can resize without a window resize (carousel slides settling,
    // bubbles animating in, fonts loading) — re-fit or the canvas paints stretched
    if (window.ResizeObserver){
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.container);
    }
  }

  // map every vertex's x,y onto 0..1 UV so the card art lands on the front face
  _planarUV(geo){
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++){
      uv.setXY(i, (pos.getX(i) + CARD_W / 2) / CARD_W, (pos.getY(i) + CARD_H / 2) / CARD_H);
    }
    uv.needsUpdate = true;
  }

  // Build the card face as a CanvasTexture rendered ENTIRELY in code from the card-studio config
  // (this.c) — background, sheen, pattern, chip, and all text (brand, number, cardholder NAME,
  // expiry, network). The name is live text (this.cfg.name) so it's fully editable. No baked PNG.
  _loadAlbedo(){
    const canvas = document.createElement('canvas');
    canvas.width = 1100; canvas.height = 693;          // card aspect ~1.586
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const draw = () => {
      try { this._renderCard(ctx, canvas.width, canvas.height); }
      catch (e) { console.error('[MaisonCard3D] render', e); }
      tex.needsUpdate = true;
      this._needsRender = true;
    };
    draw();
    // redraw once the brand fonts are ready so the text isn't drawn in a fallback face
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(draw).catch(() => {});
    }
    return tex;
  }

  _hexRGB(h){
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const n = parseInt(h || '888888', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  _mix(a, b, t){
    const x = this._hexRGB(a), y = this._hexRGB(b);
    return 'rgb(' + Math.round(x[0]+(y[0]-x[0])*t) + ',' + Math.round(x[1]+(y[1]-x[1])*t) + ',' + Math.round(x[2]+(y[2]-x[2])*t) + ')';
  }
  _lum(h){ const c = this._hexRGB(h); return c[0]*0.299 + c[1]*0.587 + c[2]*0.114; }
  _roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }
  _drawHexPattern(ctx, W, H, color){
    const r = W*0.030, dx = r*1.5, dy = r*Math.sqrt(3);
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, W*0.0011);
    for (let col=0; col*dx < W+r; col++){
      const x = col*dx, yoff = (col % 2) ? dy/2 : 0;
      for (let y=yoff; y < H+r; y += dy){
        ctx.beginPath();
        for (let i=0; i<6; i++){ const a = Math.PI/3*i, px = x + r*Math.cos(a), py = y + r*Math.sin(a); if (i===0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.restore();
  }
  // fine engraved grid, sized to sit as quietly as the hex pattern
  _drawGridPattern(ctx, W, H, color){
    const step = W*0.042;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, W*0.0011);
    ctx.beginPath();
    for (let x = step; x < W; x += step){ ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = step; y < H; y += step){ ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke(); ctx.restore();
  }
  _drawChip(ctx, W, H){
    const c = this.c || {};
    const x = 0.072*W, y = 0.30*H, w = 0.135*W, h = 0.165*H, r = h*0.18;
    const gold = (c.chip||'').toLowerCase() === 'gold';
    const g = ctx.createLinearGradient(x, y, x+w, y+h);
    if (gold){ g.addColorStop(0,'#f6e9b8'); g.addColorStop(0.5,'#d8b558'); g.addColorStop(1,'#b08a36'); }
    else { g.addColorStop(0,'#eceef1'); g.addColorStop(0.5,'#c5c9cf'); g.addColorStop(1,'#9ba1a9'); }
    const line = gold ? 'rgba(74,58,22,0.40)' : 'rgba(44,48,56,0.34)';
    const lw = Math.max(1, w*0.028);
    // Contact pattern maps the app's canonical chip SVG (viewBox 71.42 x 60.76) onto the chip rect,
    // so the rendered card matches the chip used everywhere else in the product (chipMarkup).
    const VW = 71.42, VH = 60.76, px = (v)=> x + (v/VW)*w, py = (v)=> y + (v/VH)*h;
    ctx.save();
    this._roundRect(ctx, x, y, w, h, r); ctx.fillStyle = g; ctx.fill(); ctx.clip();
    ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(px(35.71), py(0.6));   ctx.lineTo(px(35.71), py(20.9));                                  // top centre stem
    ctx.moveTo(px(35.71), py(39.12)); ctx.lineTo(px(35.71), py(60.16));                                 // bottom centre stem
    ctx.moveTo(px(0.6),   py(17.04)); ctx.lineTo(px(22.0), py(17.04)); ctx.lineTo(px(27.0), py(21.5));   // top-left arm
    ctx.moveTo(px(0.6),   py(43.66)); ctx.lineTo(px(22.0), py(43.66)); ctx.lineTo(px(27.0), py(39.2));   // bottom-left arm
    ctx.moveTo(px(0.6),   py(30.38)); ctx.lineTo(px(26.5), py(30.38));                                   // left middle
    ctx.moveTo(px(70.82), py(17.04)); ctx.lineTo(px(49.4), py(17.04)); ctx.lineTo(px(44.4), py(21.5));   // top-right arm
    ctx.moveTo(px(70.82), py(43.66)); ctx.lineTo(px(49.4), py(43.66)); ctx.lineTo(px(44.4), py(39.2));   // bottom-right arm
    ctx.moveTo(px(70.82), py(30.38)); ctx.lineTo(px(44.92), py(30.38));                                  // right middle
    ctx.stroke();
    // central contact pad, drawn on top so the arm ends tuck under it
    this._roundRect(ctx, px(26.5), py(21.24), (18.42/VW)*w, (18.22/VH)*h, Math.max(1, w*0.012));
    ctx.fillStyle = g; ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  _renderCard(ctx, W, H){
    const c = this.c || {};
    const colorA = c.colorA || '#8b8e93', colorB = c.colorB || colorA;
    const dark = this._lum(colorA) < 115;
    const tc = c.textColors || {};
    const tcol = (k) => tc[k] || c.textColor || (dark ? '#ffffff' : '#f3f3f5');
    // base diagonal gradient
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, this._mix(colorA, '#ffffff', 0.06));
    bg.addColorStop(0.5, this._mix(colorA, colorB, 0.5));
    bg.addColorStop(1, this._mix(colorB, '#000000', 0.07));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // Shimmer Sweep disabled — no diagonal light band painted on the card face.
    // pattern
    const pat = (c.pattern||'').toLowerCase();
    // white hex/grid — bumped so it reads on the very dark cards (Everyday's near-black) too
    const patCol = dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.09)';
    if (pat === 'hex') this._drawHexPattern(ctx, W, H, patCol);
    else if (pat === 'grid') this._drawGridPattern(ctx, W, H, patCol);
    // chip
    this._drawChip(ctx, W, H);
    // ----- text -----
    // The face carries only THREE elements: the chip (drawn above), the Maison wordmark, and the
    // VISA logo. The card number, cardholder name and expiry are intentionally not drawn.
    ctx.textBaseline = 'alphabetic';
    const ls = (px) => { if ('letterSpacing' in ctx) { try { ctx.letterSpacing = px + 'px'; } catch (e) {} } };
    // brand wordmark (serif, like the Maison logo) — RIGHT-aligned to the VISA logo's right edge (0.945W)
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.97; ctx.fillStyle = tcol('brand');
    ctx.font = '500 ' + (0.094*H) + 'px Georgia,"Times New Roman",serif';
    ls(0); ctx.fillText(c.brand || 'Maison', 0.945*W, 0.176*H);
    ctx.textAlign = 'left';
    // network wordmark — the real VISA logo (SVG path), drawn bottom-right as a Path2D
    if ((c.network||'visa').toLowerCase() === 'visa') {
      const vd = 'M15.854 11.329l-2.003 9.367h-2.424l2.006-9.367zM26.051 17.377l1.275-3.518 0.735 3.518zM28.754 20.696h2.242l-1.956-9.367h-2.069c-0.003-0-0.007-0-0.010-0-0.459 0-0.853 0.281-1.019 0.68l-0.003 0.007-3.635 8.68h2.544l0.506-1.4h3.109zM22.429 17.638c0.010-2.473-3.419-2.609-3.395-3.714 0.008-0.336 0.327-0.694 1.027-0.785 0.13-0.013 0.28-0.021 0.432-0.021 0.711 0 1.385 0.162 1.985 0.452l-0.027-0.012 0.425-1.987c-0.673-0.261-1.452-0.413-2.266-0.416h-0.001c-2.396 0-4.081 1.275-4.096 3.098-0.015 1.348 1.203 2.099 2.122 2.549 0.945 0.459 1.262 0.754 1.257 1.163-0.006 0.63-0.752 0.906-1.45 0.917-0.032 0.001-0.071 0.001-0.109 0.001-0.871 0-1.691-0.219-2.407-0.606l0.027 0.013-0.439 2.052c0.786 0.315 1.697 0.497 2.651 0.497 0.015 0 0.030-0 0.045-0h-0.002c2.546 0 4.211-1.257 4.22-3.204zM12.391 11.329l-3.926 9.367h-2.562l-1.932-7.477c-0.037-0.364-0.26-0.668-0.57-0.82l-0.006-0.003c-0.688-0.338-1.488-0.613-2.325-0.786l-0.066-0.011 0.058-0.271h4.124c0 0 0.001 0 0.001 0 0.562 0 1.028 0.411 1.115 0.948l0.001 0.006 1.021 5.421 2.522-6.376z';
      const vH = 0.07*H, vs = vH/9.367;   // VISA glyph spans y 11.329..20.696 (~9.367) in the 0..32 viewBox
      ctx.save();
      ctx.globalAlpha = 0.97; ctx.fillStyle = c.networkColor || tcol('label');
      ctx.translate(0.945*W - 31*vs, 0.888*H - 20.696*vs);   // anchor right edge ~0.945W, bottom ~0.888H
      ctx.scale(vs, vs);
      ctx.fill(new Path2D(vd));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  _fitCamera(aspect){
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const distH = (CARD_H / 2) / Math.tan(vFov / 2);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const distW = (CARD_W / 2) / Math.tan(hFov / 2);
    // FLUSH fit: the front face exactly fills the frame, matching the full-bleed
    // card stills — so still <-> live swaps (carousel focus) don't change the size.
    this.camera.position.set(0, 0, Math.max(distH, distW) + CARD_T / 2);
    this.camera.lookAt(0, 0, 0);
  }

  _bindInput(){
    const el = this.container;
    // map a client point inside the card to a tilt target
    this._pointTo = (clientX, clientY) => {
      const r = el.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      this.tRY = (px - 0.5) * 0.62;
      this.tRX = (py - 0.5) * 0.46;
    };

    // desktop: hover
    this._onMove = (e) => this._pointTo(e.clientX, e.clientY);
    this._onLeave = () => { this.tRX = 0; this.tRY = 0; };
    el.addEventListener('mousemove', this._onMove);
    el.addEventListener('mouseleave', this._onLeave);

    // mobile: drag with a finger. Decide intent on first move so vertical swipes
    // still scroll the page; a sideways drag grabs the card (and overrides the gyro).
    this._onTouchStart = (e) => {
      if (!e.touches || !e.touches.length) return;
      this._tStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      this._dragDecided = false; this._dragging = false;
    };
    this._onTouchMove = (e) => {
      if (!this._tStart || !e.touches || !e.touches.length) return;
      const t = e.touches[0];
      if (!this._dragDecided){
        const dx = Math.abs(t.clientX - this._tStart.x), dy = Math.abs(t.clientY - this._tStart.y);
        if (dx + dy < 6) return;                 // wait for a clear gesture
        this._dragDecided = true;
        this._dragging = dx >= dy;               // sideways -> drag the card; vertical -> let it scroll
      }
      if (this._dragging){ e.preventDefault(); this._pointTo(t.clientX, t.clientY); }
    };
    this._onTouchEnd = () => {
      this._dragging = false; this._dragDecided = false; this._tStart = null;
      if (!this._gyroActive){ this.tRX = 0; this.tRY = 0; }   // ease flat only if no gyro to take over
    };
    el.addEventListener('touchstart', this._onTouchStart, { passive: true });
    el.addEventListener('touchmove', this._onTouchMove, { passive: false });
    el.addEventListener('touchend', this._onTouchEnd);
    el.addEventListener('touchcancel', this._onTouchEnd);

    // mobile: tilt the phone (gyroscope) — yields to an active finger drag
    this._onOrient = (e) => {
      if (this._dragging || e.beta == null || e.gamma == null) return;
      if (this._baseB == null){ this._baseB = e.beta; this._baseG = e.gamma; }
      this.tRY = Math.max(-0.6, Math.min(0.6, (e.gamma - this._baseG) / 45 * 0.6));
      this.tRX = Math.max(-0.5, Math.min(0.5, (e.beta - this._baseB) / 45 * 0.5));
    };
    const enableGyro = () => { window.addEventListener('deviceorientation', this._onOrient, true); this._gyroActive = true; };
    if (typeof DeviceOrientationEvent !== 'undefined'){
      if (typeof DeviceOrientationEvent.requestPermission === 'function'){
        this._perm = () => DeviceOrientationEvent.requestPermission()
          .then(s => { if (s === 'granted') enableGyro(); }).catch(() => {});
        document.addEventListener('touchstart', this._perm, { once: true, passive: true });
      } else {
        enableGyro();
      }
    }
  }

  _resize(){
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);   // buffer only — CSS keeps the canvas at 100% of the frame
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._fitCamera(w / h);
  }

  _loop(){
    const t = ((window.performance && performance.now()) ? performance.now() : 0) - this._t0;
    this.rx += (this.tRX - this.rx) * 0.09;
    this.ry += (this.tRY - this.ry) * 0.09;
    // Float Animation disabled — no idle sway; the card holds still.
    const idle = 0;
    this.group.rotation.x = this.rx;
    this.group.rotation.y = this.ry + idle;
    this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(this._loop);
  }

  dispose(){
    cancelAnimationFrame(this._raf);
    this.container.removeEventListener('mousemove', this._onMove);
    this.container.removeEventListener('mouseleave', this._onLeave);
    this.container.removeEventListener('touchstart', this._onTouchStart);
    this.container.removeEventListener('touchmove', this._onTouchMove);
    this.container.removeEventListener('touchend', this._onTouchEnd);
    this.container.removeEventListener('touchcancel', this._onTouchEnd);
    window.removeEventListener('deviceorientation', this._onOrient, true);
    if (this._perm) document.removeEventListener('touchstart', this._perm, { once: true });
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this.material){ if (this.material.map) this.material.map.dispose(); this.material.dispose(); }
    if (this.mesh) this.mesh.geometry.dispose();
    if (this.envRT) this.envRT.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}

const api = {
  available: (function(){
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  })(),
  mount(container, cfg){
    if (!api.available || !container) return null;
    try { return new Card3D(container, cfg); }
    catch (e){ console.error('[MaisonCard3D] mount failed', e); return null; }
  }
};

window.MaisonCard3D = api;
export default api;
