/* Enlarger app. Keep APP_VERSION equal to VERSION in sw.js and "version" in version.json. */
'use strict';
const APP_VERSION = '1.0.1';

// AI libraries, loaded only when an AI mode is used. Each entry lists fallbacks tried in order.
const LIBS = {
  tf: ['https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js'],
  webgpu: ['https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgpu@4.22.0/dist/tf-backend-webgpu.min.js'],
  upscaler: [
    'https://cdn.jsdelivr.net/npm/upscaler@1.0.0-beta.19/dist/browser/umd/upscaler.min.js',
    'https://cdn.jsdelivr.net/npm/upscaler@latest/dist/browser/umd/upscaler.min.js'
  ]
};
const MODELS = {
  fast: { pkg: '@upscalerjs/esrgan-slim', label: 'ESRGAN slim 4×' },
  quality: { pkg: '@upscalerjs/esrgan-medium', label: 'ESRGAN medium 4×' },
  max: { pkg: '@upscalerjs/esrgan-thick', label: 'ESRGAN thick 4×' }
};
const modelUrls = pkg => [
  `https://cdn.jsdelivr.net/npm/${pkg}@1.0.0-beta.12/dist/umd/4x.min.js`,
  `https://cdn.jsdelivr.net/npm/${pkg}@latest/dist/umd/4x.min.js`,
  `https://cdn.jsdelivr.net/npm/${pkg}@latest/dist/umd/models/4x.min.js`
];

const $ = id => document.getElementById(id);
const fmtMB = b => (b / 1048576).toFixed(b < 10485760 ? 1 : 1) + ' MB';
const fmtIn = v => (Math.round(v * 10) / 10).toString().replace(/\.0$/, '');
const sleep0 = () => new Promise(r => setTimeout(r, 0));
const IS_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const CANVAS_MAX = 16777216; // iPhone/iPad Safari canvas limit in pixels
const JOB_KEY = 'enlarger.job';

/* ---------------- settings ---------------- */
const DEFAULTS = { autoCheck: true, defSize: 'p:20x30', defCap: '10', theme: 'system', tile: '512', bigModel: false, webgpu: false, wake: true, lastCheck: 0 };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('enlarger.settings') || '{}')); } catch (e) {}
function saveSettings() { try { localStorage.setItem('enlarger.settings', JSON.stringify(settings)); } catch (e) {} }
function applyTheme() {
  if (settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
}
applyTheme();

/* ---------------- state ---------------- */
const S = {
  bmp: null, srcW: 0, srcH: 0, name: '', bytes: 0,
  size: settings.defSize, orient: 'auto', dpi: 200,
  ciW: 20, ciH: 30, cpW: 4000, cpH: 6000,
  zoom: 1, fx: 0.5, fy: 0.5,
  mode: 'quality', sharpen: 0, format: 'jpeg', cap: Number(settings.defCap), quality: 92,
  busy: false, cancel: false, result: null, blob: null, loupe: null
};

/* ---------------- toast ---------------- */
let toastT;
function toast(msg, ms = 3200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
}

/* ---------------- segmented controls ---------------- */
function seg(id, value, onChange) {
  const el = $(id);
  const set = v => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  set(value);
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || S.busy) return;
    set(b.dataset.v); onChange(b.dataset.v);
  });
  return set;
}

/* ---------------- geometry ---------------- */
function target() {
  const v = S.size, dpi = S.dpi;
  const portraitPhoto = S.srcH >= S.srcW || !S.bmp;
  let W, H, pw, ph, keepShape = false;
  if (v.startsWith('p:') || v === 'ci') {
    let a, b;
    if (v === 'ci') { a = +S.ciW || 1; b = +S.ciH || 1; } else { [a, b] = v.slice(2).split('x').map(Number); }
    if (v === 'ci' && S.orient === 'auto') { pw = a; ph = b; }
    else {
      const sh = Math.min(a, b), lg = Math.max(a, b);
      const tall = S.orient === 'portrait' || (S.orient === 'auto' && portraitPhoto);
      pw = tall ? sh : lg; ph = tall ? lg : sh;
    }
    W = Math.round(pw * dpi); H = Math.round(ph * dpi);
  } else if (v.startsWith('s:')) {
    const k = +v.slice(2); keepShape = true;
    W = Math.round((S.srcW || 1000) * k); H = Math.round((S.srcH || 1400) * k);
    pw = W / dpi; ph = H / dpi;
  } else {
    W = Math.max(16, Math.round(+S.cpW || 16)); H = Math.max(16, Math.round(+S.cpH || 16));
    pw = W / dpi; ph = H / dpi;
  }
  return { W, H, pw, ph, keepShape };
}

function cropRect() {
  const { W, H } = target();
  const a = W / H, sw = S.srcW, sh = S.srcH;
  let cw, ch;
  if (sw / sh > a) { ch = sh; cw = ch * a; } else { cw = sw; ch = cw / a; }
  cw *= S.zoom; ch *= S.zoom;
  let x = S.fx * sw - cw / 2, y = S.fy * sh - ch / 2;
  x = Math.max(0, Math.min(sw - cw, x)); y = Math.max(0, Math.min(sh - ch, y));
  return { x, y, w: cw, h: ch };
}

function assess() {
  if (!S.bmp) return null;
  const t = target(), c = cropRect();
  const scale = t.W / c.w;
  const origPpi = c.w / t.pw;
  const ai = S.mode !== 'classic';
  let level, label, text;
  if (scale <= 1.02) { level = 'ok'; label = 'Ready'; text = 'Your photo already has enough pixels. It will be resized without AI.'; }
  else if (ai) {
    if (scale <= 4.6) { level = 'ok'; label = 'Great'; text = `A ${scale.toFixed(1)}× enlargement is within what the AI does well.`; }
    else if (scale <= 6.5) { level = 'warn'; label = 'Fair'; text = `${scale.toFixed(1)}× is past the AI's 4× sweet spot. Expect softer fine detail. A lower ppi or a smaller print looks crisper.`; }
    else { level = 'bad'; label = 'Too far'; text = `${scale.toFixed(1)}× asks for detail the photo doesn't have. Choose 150 ppi, a smaller size, or zoom out.`; }
  } else {
    if (scale <= 1.6) { level = 'ok'; label = 'Fine'; text = 'Small enlargements look fine without AI.'; }
    else if (scale <= 2.6) { level = 'warn'; label = 'Soft'; text = 'Without AI this will look a little soft. Try "AI best" for sharper detail.'; }
    else { level = 'bad'; label = 'Blurry'; text = `At ${scale.toFixed(1)}×, a plain resize looks blurry. Use "AI best".`; }
  }
  return { t, c, scale, origPpi, level, label, text, mp: t.W * t.H / 1e6, bytes: t.W * t.H * 4 };
}

/* ---------------- UI refresh ---------------- */
function refresh() {
  const t = target();
  $('roPx').textContent = `${t.W.toLocaleString()} × ${t.H.toLocaleString()} px · ${(t.W * t.H / 1e6).toFixed(1)} MP`;
  $('roMp').textContent = `${fmtIn(t.pw)} × ${fmtIn(t.ph)} in`;
  $('customInches').hidden = S.size !== 'ci';
  $('customPixels').hidden = S.size !== 'cp';
  $('orientField').hidden = S.size.startsWith('s:') || S.size === 'cp';
  const a = assess();
  const runBtn = $('runBtn');
  if (!a) {
    $('roScale').textContent = '—'; $('roPpi').textContent = '—'; $('verdict').hidden = true;
    runBtn.disabled = true; runBtn.textContent = 'Choose a photo to start';
    return;
  }
  $('roScale').textContent = `${a.scale.toFixed(2)}×`;
  $('roPpi').textContent = `${Math.round(a.origPpi)} ppi`;
  const v = $('verdict'); v.hidden = false; v.className = 'verdict v-' + a.level;
  $('vPill').textContent = a.label;
  let extra = '';
  const mem = navigator.deviceMemory;
  if (a.mp > 35) {
    extra = ` ${Math.round(a.mp)} MP is a very large job for a phone and may run out of memory.`;
    if (S.dpi === 300) extra += ' 200 ppi looks the same on a poster viewed from normal distance and is much easier.';
    if (S.cap > 0 && S.cap <= 10) extra += ` A file this big is unlikely to fit under ${S.cap} MB.`;
    if (v.className.includes('v-ok')) { v.className = 'verdict v-warn'; $('vPill').textContent = 'Heavy'; }
  } else if (mem && mem <= 4 && a.bytes > 120e6) extra = ` This is a large job (${Math.round(a.mp)} MP) for this device.`;
  $('vText').textContent = a.text + extra;
  $('cropStep').hidden = false;
  const c = a.c;
  $('cropNote').textContent = `${Math.round(c.w)} × ${Math.round(c.h)} px used`;
  $('cropAside').textContent = t.keepShape ? 'whole photo' : `${Math.round(c.w / S.srcW * 100)}% × ${Math.round(c.h / S.srcH * 100)}%`;
  $('cropHint').textContent = t.keepShape
    ? 'The whole photo is used. Zoom in to crop tighter.'
    : 'Drag to choose what stays in the print. Anything outside the frame is trimmed so the photo fits the paper shape.';
  runBtn.disabled = S.busy;
  if (!S.busy) runBtn.textContent = `Enlarge to ${t.W.toLocaleString()} × ${t.H.toLocaleString()}`;
  drawCrop();
}

/* ---------------- crop canvas ---------------- */
const cropCanvas = $('cropCanvas');
let cropView = null;
function drawCrop() {
  if (!S.bmp) return;
  const wrap = $('cropWrap');
  const cssW = wrap.clientWidth || 600;
  const maxH = Math.min(window.innerHeight * 0.55, 560);
  let dw = cssW, dh = dw * S.srcH / S.srcW;
  if (dh > maxH) { dh = maxH; dw = dh * S.srcW / S.srcH; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cropCanvas.width = Math.round(cssW * dpr); cropCanvas.height = Math.round(dh * dpr);
  cropCanvas.style.height = dh + 'px';
  const ctx = cropCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, dh);
  const ox = (cssW - dw) / 2, k = dw / S.srcW;
  cropView = { ox, k, cssW, dh };
  ctx.drawImage(S.bmp, ox, 0, dw, dh);
  const c = cropRect();
  const rx = ox + c.x * k, ry = c.y * k, rw = c.w * k, rh = c.h * k;
  ctx.fillStyle = 'rgba(8,12,18,.58)';
  ctx.beginPath(); ctx.rect(ox, 0, dw, dh); ctx.rect(rx, ry, rw, rh); ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 3; i++) { ctx.moveTo(rx + rw * i / 3, ry); ctx.lineTo(rx + rw * i / 3, ry + rh); ctx.moveTo(rx, ry + rh * i / 3); ctx.lineTo(rx + rw, ry + rh * i / 3); }
  ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(rx + .75, ry + .75, rw - 1.5, rh - 1.5);
  // printer's crop marks at the corners
  const m = Math.min(18, rw / 5, rh / 5); ctx.lineWidth = 3;
  ctx.beginPath();
  [[rx, ry, 1, 1], [rx + rw, ry, -1, 1], [rx, ry + rh, 1, -1], [rx + rw, ry + rh, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.moveTo(x + sx * 1.5, y + sy * (m + 1.5)); ctx.lineTo(x + sx * 1.5, y + sy * 1.5); ctx.lineTo(x + sx * (m + 1.5), y + sy * 1.5);
  });
  ctx.stroke();
}
(function cropDrag() {
  let drag = null;
  cropCanvas.addEventListener('pointerdown', e => {
    if (!S.bmp || S.busy) return;
    cropCanvas.setPointerCapture(e.pointerId);
    const c = cropRect();
    drag = { x: e.clientX, y: e.clientY, cx: c.x + c.w / 2, cy: c.y + c.h / 2 };
  });
  cropCanvas.addEventListener('pointermove', e => {
    if (!drag || !cropView) return;
    const dx = (e.clientX - drag.x) / cropView.k, dy = (e.clientY - drag.y) / cropView.k;
    const c = cropRect();
    const cx = Math.max(c.w / 2, Math.min(S.srcW - c.w / 2, drag.cx + dx));
    const cy = Math.max(c.h / 2, Math.min(S.srcH - c.h / 2, drag.cy + dy));
    S.fx = cx / S.srcW; S.fy = cy / S.srcH;
    refresh();
  });
  const end = () => { drag = null; };
  cropCanvas.addEventListener('pointerup', end); cropCanvas.addEventListener('pointercancel', end);
})();
window.addEventListener('resize', () => { drawCrop(); drawResultPreview(); });

/* ---------------- loading a photo ---------------- */
async function loadFile(file) {
  if (!file) return;
  if (S.busy) { toast('Wait for the current job to finish.'); return; }
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image(); img.src = url; await img.decode();
      bmp = await createImageBitmap(img); URL.revokeObjectURL(url);
    } catch (e2) { toast("This photo couldn't be opened. Try a JPEG or PNG."); return; }
  }
  setPhoto(bmp, file.name || 'photo', file.size);
}
function setPhoto(bmp, name, bytes) {
  S.bmp = bmp; S.srcW = bmp.width; S.srcH = bmp.height; S.name = name.replace(/\.[^.]+$/, ''); S.bytes = bytes;
  S.fx = 0.5; S.fy = 0.5; S.zoom = 1; $('zoom').value = 100;
  clearResult();
  const tc = document.createElement('canvas'); const ts = 128 / Math.max(S.srcW, S.srcH);
  tc.width = Math.round(S.srcW * ts); tc.height = Math.round(S.srcH * ts);
  tc.getContext('2d').drawImage(bmp, 0, 0, tc.width, tc.height);
  $('thumb').src = tc.toDataURL('image/jpeg', 0.8);
  $('fileName').textContent = name;
  $('fileInfo').textContent = `${S.srcW} × ${S.srcH} px` + (bytes ? ` · ${fmtMB(bytes)}` : '');
  $('srcAside').textContent = `${(S.srcW * S.srcH / 1e6).toFixed(1)} MP`;
  $('drop').hidden = true; $('sampleBtn').hidden = true; $('fileLine').hidden = false;
  refresh();
}
$('fileInput').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
$('replace').addEventListener('click', () => $('fileInput').click());
(function dnd() {
  const d = $('drop');
  ['dragenter', 'dragover'].forEach(t => d.addEventListener(t, e => { e.preventDefault(); d.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => d.addEventListener(t, e => { e.preventDefault(); d.classList.remove('over'); }));
  d.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
  document.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/')); if (f) loadFile(f); });
})();

/* ---------------- AI engine ---------------- */
const loadedScripts = new Map();
function loadScript(src) {
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => { loadedScripts.delete(src); s.remove(); rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  loadedScripts.set(src, p);
  return p;
}
async function loadFirst(urls) {
  let err;
  for (const u of urls) { try { await loadScript(u); return u; } catch (e) { err = e; } }
  throw err;
}
let tfReady = null;
async function ensureTf() {
  if (tfReady) return tfReady;
  tfReady = (async () => {
    await loadFirst(LIBS.tf);
    let backend = 'webgl';
    if (settings.webgpu && navigator.gpu) {
      try { await loadFirst(LIBS.webgpu); if (await tf.setBackend('webgpu')) backend = 'webgpu'; } catch (e) { backend = 'webgl'; }
    }
    if (backend === 'webgl') { try { if (!(await tf.setBackend('webgl'))) throw 0; } catch (e) { await tf.setBackend('cpu'); backend = 'cpu'; } }
    await tf.ready();
    await loadFirst(LIBS.upscaler);
    if (typeof window.Upscaler !== 'function') throw new Error('Upscaler library missing');
    return tf.getBackend();
  })();
  tfReady.catch(() => { tfReady = null; });
  return tfReady;
}
const aiEngines = {};
async function loadAI(key) {
  if (aiEngines[key]) return aiEngines[key];
  const backend = await ensureTf();
  const before = new Set(Object.keys(window));
  await loadFirst(modelUrls(MODELS[key].pkg));
  let model = null;
  for (const k of Object.keys(window)) {
    if (before.has(k)) continue;
    const v = window[k];
    if (v && typeof v === 'object' && (v.path || v.modelType || v.scale || v.meta)) { model = v; break; }
  }
  if (!model) {
    const guess = Object.keys(window).find(k => /esrgan/i.test(k) && /4x/i.test(k));
    if (guess) model = window[guess];
  }
  if (!model) throw new Error('AI model not found');
  const up = new window.Upscaler({ model });
  const engine = {
    backend,
    async run(canvas) {
      const input = tf.browser.fromPixels(canvas);
      let out;
      try { out = await up.execute(input, { output: 'tensor' }); }
      finally { input.dispose(); }
      let t3 = out.rank === 4 ? out.squeeze([0]) : out;
      const maxT = t3.max(); const mx = (await maxT.data())[0]; maxT.dispose();
      const scaled = tf.tidy(() => (mx <= 1.5 ? t3.mul(255) : t3).clipByValue(0, 255).round().toInt());
      const [h, w] = scaled.shape;
      const px = await tf.browser.toPixels(scaled);
      scaled.dispose(); if (t3 !== out) t3.dispose(); out.dispose();
      const oc = getCanvas('ai', w, h);
      oc.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
      return oc;
    }
  };
  // warm up so the first real piece isn't slow, and check the scale
  const probe = getCanvas('probe', 16, 16);
  const pc = probe.getContext('2d'); pc.fillStyle = '#888'; pc.fillRect(0, 0, 16, 16);
  const res = await engine.run(probe);
  engine.factor = Math.round(res.width / 16) || 4;
  aiEngines[key] = engine;
  $('engineInfo').textContent = `AI engine: ${MODELS[key].label} on ${backend.toUpperCase()}.`;
  return engine;
}

/* ---------------- canvases ---------------- */
const canvases = {};
function getCanvas(name, w, h) {
  let c = canvases[name];
  if (!c) { c = canvases[name] = document.createElement('canvas'); }
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}
function ctxOf(c, read) { return c.getContext('2d', read ? { willReadFrequently: true } : undefined); }

function unsharp(img, amount) {
  if (amount <= 0) return;
  const { data: d, width: w, height: h } = img;
  const src = new Uint8ClampedArray(d);
  const a = amount;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const i = p + c;
        const blur = (src[i - 4] + src[i + 4] + src[i - w * 4] + src[i + w * 4] + src[i - w * 4 - 4] + src[i - w * 4 + 4] + src[i + w * 4 - 4] + src[i + w * 4 + 4] + src[i]) / 9;
        d[i] = src[i] + a * (src[i] - blur);
      }
    }
  }
}

/* ---------------- the job ---------------- */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && settings.wake && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (S.busy && document.visibilityState === 'visible') keepAwake(true); });

function setBusy(b) {
  S.busy = b;
  $('runBtn').hidden = b; $('cancelBtn').hidden = !b; $('progress').hidden = !b;
  document.querySelectorAll('main select, main input, #replace').forEach(el => (el.disabled = b));
  $('installUpd').disabled = b; $('bannerInstall').disabled = b;
  if (!b) refresh();
}
function progress(stage, frac, eta) {
  $('progStage').textContent = stage;
  $('progBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  $('progEta').textContent = eta || '';
}
function etaText(sec) {
  if (!isFinite(sec) || sec < 0) return '';
  if (sec < 50) return `about ${Math.max(5, Math.round(sec / 5) * 5)} s left`;
  return `about ${Math.round(sec / 60)} min left`;
}

async function run() {
  if (!S.bmp || S.busy) return;
  const a = assess();
  const { W, H } = a.t, crop = a.c;
  S.cancel = false; setBusy(true); keepAwake(true);
  clearResult();
  progress('Preparing', 0);
  try { localStorage.setItem(JOB_KEY, JSON.stringify({ W, H, dpi: S.dpi, ai: S.mode !== 'classic', t: Date.now() })); } catch (e) {}
  let buf;
  try { buf = new Uint8ClampedArray(W * H * 4); }
  catch (e) { jobEnded(); setBusy(false); keepAwake(false); toast(`Not enough memory for ${Math.round(W * H / 1e6)} MP. Choose 200 ppi or a smaller size.`, 7000); return; }

  let engine = null;
  const useAI = S.mode !== 'classic' && a.scale > 1.02;
  if (useAI) {
    const key = S.mode === 'fast' ? 'fast' : (settings.bigModel ? 'max' : 'quality');
    progress(aiEngines[key] ? 'Starting AI' : 'Downloading AI model (first time only)', 0.02);
    try { engine = await loadAI(key); }
    catch (e) {
      console.error(e);
      toast("The AI model couldn't load (are you offline?). Using Classic instead.", 6000);
      engine = null;
    }
  }
  if (S.cancel) return finishCancel();

  const f = engine ? engine.factor : 1;
  const sx = W / crop.w, sy = H / crop.h;
  const T = +settings.tile || 512;
  const sharpen = (S.sharpen / 100) * 1.4 + (engine ? 0 : 0);
  const om = sharpen > 0 ? 2 : 0;
  const pad = engine ? 8 : 3;
  const p = Math.min(1, 1400 / Math.max(W, H));
  const prev = getCanvas('preview', Math.max(1, Math.round(W * p)), Math.max(1, Math.round(H * p)));
  const pctx = ctxOf(prev); pctx.imageSmoothingEnabled = true; pctx.imageSmoothingQuality = 'high';
  const cols = Math.ceil(W / T), rows = Math.ceil(H / T), total = cols * rows;
  let done = 0; const t0 = performance.now();

  try {
    for (let oy = 0; oy < H; oy += T) {
      for (let ox = 0; ox < W; ox += T) {
        if (S.cancel) return finishCancel();
        const tw = Math.min(T, W - ox), th = Math.min(T, H - oy);
        const ex0 = Math.max(0, ox - om), ey0 = Math.max(0, oy - om);
        const ex1 = Math.min(W, ox + tw + om), ey1 = Math.min(H, oy + th + om);
        const ew = ex1 - ex0, eh = ey1 - ey0;
        const fx0 = crop.x + ex0 / sx, fx1 = crop.x + ex1 / sx, fy0 = crop.y + ey0 / sy, fy1 = crop.y + ey1 / sy;
        const ix0 = Math.max(0, Math.floor(fx0) - pad), iy0 = Math.max(0, Math.floor(fy0) - pad);
        const ix1 = Math.min(S.srcW, Math.ceil(fx1) + pad), iy1 = Math.min(S.srcH, Math.ceil(fy1) + pad);
        const pw = ix1 - ix0, ph = iy1 - iy0;
        let src;
        const patch = getCanvas('patch', pw, ph);
        const pc = ctxOf(patch); pc.clearRect(0, 0, pw, ph);
        pc.drawImage(S.bmp, ix0, iy0, pw, ph, 0, 0, pw, ph);
        src = engine ? await engine.run(patch) : patch;
        const tile = getCanvas('tile', ew, eh);
        const tc = ctxOf(tile, true);
        tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
        tc.clearRect(0, 0, ew, eh);
        tc.drawImage(src, (fx0 - ix0) * f, (fy0 - iy0) * f, (fx1 - fx0) * f, (fy1 - fy0) * f, 0, 0, ew, eh);
        const img = tc.getImageData(0, 0, ew, eh);
        if (sharpen > 0) { unsharp(img, sharpen); tc.putImageData(img, 0, 0); }
        const dx = ox - ex0, dy = oy - ey0;
        for (let y = 0; y < th; y++) {
          const s0 = ((y + dy) * ew + dx) * 4;
          buf.set(img.data.subarray(s0, s0 + tw * 4), ((oy + y) * W + ox) * 4);
        }
        pctx.drawImage(tile, dx, dy, tw, th, ox * p, oy * p, tw * p, th * p);
        done++;
        const el = (performance.now() - t0) / 1000;
        const eta = done >= 2 ? el / done * (total - done) : NaN;
        progress(engine ? 'Enlarging with AI' : 'Enlarging', 0.04 + 0.86 * done / total, `piece ${done} of ${total} · ${etaText(eta)}`);
        await sleep0();
      }
    }
    // alpha must be opaque
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  } catch (e) {
    console.error(e);
    setBusy(false); keepAwake(false);
    jobEnded();
    toast(`Enlarging stopped: ${e && e.message ? e.message : 'unknown error'}. Try 200 ppi, or Settings → Small pieces.`, 9000);
    return;
  }

  S.result = { buf, W, H, crop, dpi: S.dpi, pw: a.t.pw, ph: a.t.ph, ai: !!engine, scale: a.scale, secs: (performance.now() - t0) / 1000 };
  try { await exportFile(); }
  catch (e) { console.error(e); toast(`Making the file failed: ${e.message || 'unknown error'}. Try 200 ppi.`, 9000); }
  jobEnded();
  setBusy(false); keepAwake(false);
  showResult();
}
function jobEnded() { try { localStorage.removeItem(JOB_KEY); } catch (e) {} }
function finishCancel() { jobEnded(); setBusy(false); keepAwake(false); progress('', 0); toast('Stopped.'); }
$('runBtn').addEventListener('click', run);
$('cancelBtn').addEventListener('click', () => { S.cancel = true; $('progStage').textContent = 'Stopping…'; });

/* ---------------- encoding ---------------- */
let bigCanvasOk = null;
function fullCanvas(buf, W, H) {
  if (IS_PHONE && W * H > CANVAS_MAX) return null; // Safari refuses it, and trying wastes memory
  try {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); if (!ctx) return null;
    ctx.putImageData(new ImageData(buf, W, H), 0, 0);
    const probe = ctx.getImageData(W - 1, H - 1, 1, 1).data, q = (W * H - 1) * 4;
    if (probe[0] !== buf[q] || probe[1] !== buf[q + 1] || probe[2] !== buf[q + 2] || probe[3] !== 255) return null;
    return c;
  } catch (e) { return null; }
}
const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Encoding failed'))), type, q));

async function exportFile() {
  const r = S.result; if (!r) return;
  const { buf, W, H, dpi } = r;
  const cap = S.cap > 0 ? S.cap * 1048576 : Infinity;
  progress('Making the file', 0.92);
  await sleep0();
  const canvas = fullCanvas(buf, W, H);
  const E = window.EnlargerEncoders;
  let blob, q = S.quality, fits = true;
  if (S.format === 'png') {
    if (canvas) {
      const b = await toBlob(canvas, 'image/png');
      blob = new Blob([E.setPngDpi(new Uint8Array(await b.arrayBuffer()), dpi)], { type: 'image/png' });
    } else {
      const parts = await E.encodePNG(buf, W, H, dpi, f => progress('Making the PNG', 0.92 + f * 0.08));
      blob = new Blob(parts, { type: 'image/png' });
    }
    fits = blob.size <= cap; q = null;
  } else {
    const enc = async quality => {
      if (canvas) return new Uint8Array(await (await toBlob(canvas, 'image/jpeg', quality / 100)).arrayBuffer());
      return E.encodeJPEG(buf, W, H, quality, dpi, f => progress(`Making the JPEG (quality ${quality})`, 0.92 + f * 0.08));
    };
    let bytes = await enc(q);
    if (bytes.length > cap) {
      // search for the highest quality that fits
      // estimate a starting point from the first size, then narrow down
      const ratio = cap / bytes.length;
      const guess = Math.max(55, Math.min(q - 1, Math.round(q - (1 - ratio) * 60)));
      let lo = Math.max(55, guess - 8), hi = Math.min(q - 1, guess + 6), best = null, bestQ = null;
      while (lo <= hi) {
        const mid = Math.round((lo + hi) / 2);
        progress(`Fitting under ${S.cap} MB`, 0.95);
        const b = await enc(mid);
        if (b.length <= cap) { best = b; bestQ = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (best) { bytes = best; q = bestQ; }
      else { bytes = await enc(55); q = 55; fits = bytes.length <= cap; }
    }
    blob = new Blob([E.setJpegDpi(bytes, dpi)], { type: 'image/jpeg' });
  }
  if (canvas) { canvas.width = 1; canvas.height = 1; }
  S.blob = blob; r.q = q; r.fits = fits; r.format = S.format;
  progress('Done', 1);
}

/* ---------------- result ---------------- */
function clearResult() {
  S.result = null; S.blob = null; S.loupe = null;
  $('resultStep').hidden = true;
}
function showResult() {
  const r = S.result; if (!r || !S.blob) return;
  $('resultStep').hidden = false;
  const name = fileName();
  $('resAside').textContent = r.secs < 1 ? 'under 1 s' : r.secs < 90 ? `${Math.round(r.secs)} s` : `${Math.round(r.secs / 60)} min`;
  const rows = [
    ['Pixels', `${r.W.toLocaleString()} × ${r.H.toLocaleString()}`],
    ['Print', `${fmtIn(r.pw)} × ${fmtIn(r.ph)} in at ${r.dpi} ppi`],
    ['File', `${r.format.toUpperCase()} · ${fmtMB(S.blob.size)}`],
    ['Method', r.ai ? 'AI (on device)' : 'Classic resize']
  ];
  if (r.q) rows.splice(3, 0, ['Quality', String(r.q)]);
  $('resReadout').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const rv = $('resVerdict'); rv.hidden = false;
  if (S.cap > 0 && !r.fits) {
    rv.className = 'verdict v-bad'; $('resPill').textContent = 'Too big';
    $('resText').textContent = r.format === 'png' ? `PNG files this size can't fit under ${S.cap} MB. Choose JPEG, then "Save again".` : `Even at low quality this is over ${S.cap} MB. Choose a lower ppi or a smaller size.`;
  } else {
    rv.className = 'verdict v-ok'; $('resPill').textContent = 'Ready';
    $('resText').textContent = (S.cap > 0 ? `Fits under ${S.cap} MB. ` : '') + `Saves as ${name}.`;
  }
  $('shareBtn').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([S.blob], name, { type: S.blob.type })] }));
  $('cmpTagR').textContent = r.ai ? 'Enlarger AI' : 'Enlarger';
  S.loupe = { x: r.W / 2, y: r.H / 2 };
  drawResultPreview(); drawCompare();
  $('resultStep').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function fileName() {
  const r = S.result;
  return `${S.name || 'photo'}-${r.W}x${r.H}-${r.dpi}ppi.${r.format === 'png' ? 'png' : 'jpg'}`;
}
function drawResultPreview() {
  const r = S.result; if (!r || $('resultStep').hidden) return;
  const prev = canvases.preview, rc = $('resultCanvas');
  rc.width = prev.width; rc.height = prev.height;
  rc.getContext('2d').drawImage(prev, 0, 0);
  const L = loupeSize();
  const box = $('loupeBox'), k = rc.clientWidth / r.W;
  box.style.left = (S.loupe.x - L / 2) * k + 'px'; box.style.top = (S.loupe.y - L / 2) * k + 'px';
  box.style.width = box.style.height = L * k + 'px';
}
function loupeSize() { const r = S.result; return Math.min(480, r.W, r.H); }
function drawCompare() {
  const r = S.result; if (!r) return;
  const L = loupeSize();
  let lx = Math.round(S.loupe.x - L / 2), ly = Math.round(S.loupe.y - L / 2);
  lx = Math.max(0, Math.min(r.W - L, lx)); ly = Math.max(0, Math.min(r.H - L, ly));
  S.loupe.x = lx + L / 2; S.loupe.y = ly + L / 2;
  const after = $('cmpAfter'); after.width = after.height = L;
  const img = new ImageData(L, L);
  for (let y = 0; y < L; y++) img.data.set(r.buf.subarray(((ly + y) * r.W + lx) * 4, ((ly + y) * r.W + lx + L) * 4), y * L * 4);
  after.getContext('2d').putImageData(img, 0, 0);
  const before = $('cmpBefore'); before.width = before.height = L;
  const bc = before.getContext('2d'); bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'low';
  const sx = r.W / r.crop.w, sy = r.H / r.crop.h;
  bc.drawImage(S.bmp, r.crop.x + lx / sx, r.crop.y + ly / sy, L / sx, L / sy, 0, 0, L, L);
  setCmp($('cmpSlider').value);
}
function setCmp(v) { $('cmpAfter').style.clipPath = `inset(0 0 0 ${v}%)`; $('cmpHandle').style.left = v + '%'; }
$('cmpSlider').addEventListener('input', e => setCmp(e.target.value));
$('resultCanvas').addEventListener('click', e => {
  const r = S.result; if (!r) return;
  const rect = e.currentTarget.getBoundingClientRect();
  S.loupe = { x: (e.clientX - rect.left) / rect.width * r.W, y: (e.clientY - rect.top) / rect.height * r.H };
  drawCompare(); drawResultPreview();
});
$('saveBtn').addEventListener('click', () => {
  if (!S.blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(S.blob); a.download = fileName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast('Saved ' + fileName());
});
$('shareBtn').addEventListener('click', async () => {
  if (!S.blob) return;
  try { await navigator.share({ files: [new File([S.blob], fileName(), { type: S.blob.type })], title: fileName() }); }
  catch (e) { if (e.name !== 'AbortError') toast("Sharing didn't work here. Use Save instead."); }
});
$('resaveBtn').addEventListener('click', async () => {
  if (!S.result || S.busy) return;
  S.cancel = false; setBusy(true);
  try { await exportFile(); } catch (e) { toast(e.message || 'Saving failed.'); }
  setBusy(false); showResult();
});

/* ---------------- controls ---------------- */
$('size').value = S.size;
if (!$('size').value) { S.size = 'p:20x30'; $('size').value = S.size; }
$('size').addEventListener('change', e => { S.size = e.target.value; S.zoom = 1; $('zoom').value = 100; refresh(); });
seg('orient', S.orient, v => { S.orient = v; refresh(); });
seg('dpi', S.dpi, v => { S.dpi = +v; refresh(); });
['ciW', 'ciH', 'cpW', 'cpH'].forEach(id => $(id).addEventListener('input', e => { S[id] = +e.target.value; refresh(); }));
$('zoom').addEventListener('input', e => { S.zoom = +e.target.value / 100; refresh(); });
seg('mode', S.mode, v => {
  S.mode = v;
  $('modeHint').textContent = v === 'classic'
    ? 'A plain, fast resize with no AI. Good for small enlargements. Add some sharpening for big ones.'
    : v === 'fast' ? 'A smaller AI model. About twice as fast as "AI best", with slightly less fine detail.'
    : 'The AI model rebuilds fine detail and runs on this phone. The first run downloads it once, then it works offline.';
  if (v === 'classic' && S.sharpen === 0) { S.sharpen = 30; $('sharpen').value = 30; $('sharpenVal').textContent = 30; }
  refresh();
});
$('sharpen').addEventListener('input', e => { S.sharpen = +e.target.value; $('sharpenVal').textContent = S.sharpen; });
seg('format', S.format, v => { S.format = v; $('qualityField').hidden = v === 'png'; });
$('cap').value = String(S.cap);
$('cap').addEventListener('change', e => { S.cap = +e.target.value; });
$('quality').addEventListener('input', e => { S.quality = +e.target.value; $('qualityVal').textContent = S.quality; });

/* ---------------- settings sheet ---------------- */
const dlg = $('settings');
$('openSettings').addEventListener('click', () => { dlg.showModal(); $('openSettings').classList.remove('dot'); });
$('closeSettings').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
$('curVer').textContent = APP_VERSION;
(function fillDefaults() {
  const ds = $('defSize');
  [...$('size').querySelectorAll('option')].filter(o => o.value.startsWith('p:') || o.value.startsWith('s:')).forEach(o => ds.add(new Option(o.textContent, o.value)));
  ds.value = settings.defSize; $('defCap').value = settings.defCap; $('theme').value = settings.theme;
  $('tile').value = settings.tile; $('bigModel').checked = settings.bigModel; $('webgpu').checked = settings.webgpu;
  $('wake').checked = settings.wake; $('autoCheck').checked = settings.autoCheck;
  if (!navigator.gpu) { $('webgpu').disabled = true; $('webgpu').closest('label').querySelector('small').textContent = 'Not available in this browser.'; }
})();
$('defSize').addEventListener('change', e => { settings.defSize = e.target.value; saveSettings(); });
$('defCap').addEventListener('change', e => { settings.defCap = e.target.value; saveSettings(); });
$('theme').addEventListener('change', e => { settings.theme = e.target.value; saveSettings(); applyTheme(); drawCrop(); });
$('tile').addEventListener('change', e => { settings.tile = e.target.value; saveSettings(); });
$('bigModel').addEventListener('change', e => { settings.bigModel = e.target.checked; saveSettings(); });
$('webgpu').addEventListener('change', e => { settings.webgpu = e.target.checked; saveSettings(); toast('Takes effect the next time the app opens.'); });
$('wake').addEventListener('change', e => { settings.wake = e.target.checked; saveSettings(); });
$('autoCheck').addEventListener('change', e => { settings.autoCheck = e.target.checked; saveSettings(); });

$('prefetch').addEventListener('click', async e => {
  const b = e.currentTarget; b.disabled = true;
  const st = $('storeStatus'); st.className = 'status';
  try {
    for (const k of ['fast', 'quality', ...(settings.bigModel ? ['max'] : [])]) {
      st.textContent = `Downloading ${MODELS[k].label}…`;
      await loadAI(k);
    }
    st.textContent = 'AI models are saved. The app now works offline.'; st.className = 'status good';
  } catch (err) {
    console.error(err); st.textContent = "Download failed. Check your connection and try again."; st.className = 'status err';
  }
  b.disabled = false;
});
$('clearCache').addEventListener('click', () => { $('confirmClear').hidden = false; });
$('clearNo').addEventListener('click', () => { $('confirmClear').hidden = true; });
$('clearYes').addEventListener('click', async () => {
  try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) {}
  try { const regs = await navigator.serviceWorker.getRegistrations(); for (const r of regs) await r.unregister(); } catch (e) {}
  location.reload();
});

/* ---------------- updates ---------------- */
let swReg = null, reloading = false;
function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function updStatus(text, cls) { const s = $('updStatus'); s.textContent = text; s.className = 'status' + (cls ? ' ' + cls : ''); }
function showUpdateReady(info) {
  $('installUpd').hidden = false;
  $('updateBanner').hidden = false;
  if (info && info.version) {
    $('latestVer').textContent = info.version;
    $('bannerText').textContent = `Version ${info.version} is ready to install.`;
  }
  updStatus('An update is downloaded and ready.', 'attn');
  if (!dlg.open) $('openSettings').classList.add('dot');
}
function showNotes(info) {
  if (!info || !Array.isArray(info.notes) || !info.notes.length) return;
  $('updNotes').innerHTML = '';
  info.notes.forEach(n => { const li = document.createElement('li'); li.textContent = n; $('updNotes').appendChild(li); });
  $('updNotesWrap').hidden = false;
}
let latestInfo = null;
async function checkForUpdates(manual) {
  if (manual) updStatus('Checking…');
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    latestInfo = await res.json();
    $('latestVer').textContent = latestInfo.version;
    settings.lastCheck = Date.now(); saveSettings();
    const newer = cmpVer(latestInfo.version, APP_VERSION) > 0;
    if (newer) showNotes(latestInfo);
    if (!swReg) {
      if (newer) updStatus(`Version ${latestInfo.version} is out. Reload the page to get it.`, 'attn');
      else updStatus('You have the latest version.', 'good');
      return;
    }
    await swReg.update().catch(() => {});
    if (swReg.waiting) { showUpdateReady(latestInfo); return; }
    if (swReg.installing || newer) {
      updStatus(`Downloading version ${latestInfo.version}…`, 'attn');
      await waitForWaiting();
      if (swReg.waiting) showUpdateReady(latestInfo);
      else if (newer) updStatus(`Version ${latestInfo.version} is out but didn't download yet. Try again in a minute.`, 'err');
      return;
    }
    updStatus('You have the latest version.', 'good');
  } catch (e) {
    if (manual) updStatus("Couldn't check for updates. You may be offline.", 'err');
  }
}
function waitForWaiting() {
  return new Promise(res => {
    const t = setTimeout(res, 20000);
    const w = swReg.installing;
    if (!w) { setTimeout(() => { clearTimeout(t); res(); }, 1500); return; }
    w.addEventListener('statechange', () => { if (w.state === 'installed' || w.state === 'redundant') { clearTimeout(t); res(); } });
  });
}
function installUpdate() {
  if (S.busy) { toast('Finish or cancel the current job first.'); return; }
  if (swReg && swReg.waiting) { updStatus('Installing…', 'attn'); swReg.waiting.postMessage({ type: 'SKIP_WAITING' }); }
  else location.reload();
}
$('checkUpd').addEventListener('click', () => checkForUpdates(true));
$('installUpd').addEventListener('click', installUpdate);
$('bannerInstall').addEventListener('click', installUpdate);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateReady(null);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateReady(latestInfo); });
    });
    if (settings.autoCheck) setTimeout(() => checkForUpdates(false), 1500);
  }).catch(() => { updStatus('Updates work once the app is opened from its web address.'); });
} else {
  updStatus('Updates work once the app is opened from its web address.');
}

/* ---------------- sample photo (when nothing is loaded) ---------------- */
async function sample() {
  const c = document.createElement('canvas'); c.width = 1000; c.height = 1400;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 1400); g.addColorStop(0, '#7fb2e5'); g.addColorStop(0.55, '#f2d7b6'); g.addColorStop(1, '#3e5a3a');
  x.fillStyle = g; x.fillRect(0, 0, 1000, 1400);
  x.fillStyle = '#fff6e0'; x.beginPath(); x.arc(700, 420, 90, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#4c6a8a'; x.beginPath(); x.moveTo(0, 900); x.lineTo(260, 620); x.lineTo(480, 860); x.lineTo(700, 640); x.lineTo(1000, 930); x.lineTo(1000, 1400); x.lineTo(0, 1400); x.fill();
  x.fillStyle = '#2f4a2c'; for (let i = 0; i < 40; i++) { const tx = i * 26 + (i % 3) * 7, ty = 1020 + (i % 5) * 18; x.beginPath(); x.moveTo(tx, ty); x.lineTo(tx + 18, ty + 120); x.lineTo(tx - 18, ty + 120); x.fill(); }
  x.fillStyle = '#1b2a3a'; x.font = '700 64px Georgia, serif'; x.fillText('Sample', 70, 160);
  const bmp = await createImageBitmap(c);
  setPhoto(bmp, 'sample.jpg', 0);
}
$('sampleBtn').addEventListener('click', sample);
(function lastJobCheck() {
  let job = null;
  try { job = JSON.parse(localStorage.getItem(JOB_KEY) || 'null'); } catch (e) {}
  if (!job) return;
  jobEnded();
  if (Date.now() - job.t > 6 * 3600e3) return;
  const mp = Math.round(job.W * job.H / 1e6);
  setTimeout(() => toast(`The last enlargement (${job.W.toLocaleString()} × ${job.H.toLocaleString()}, ${mp} MP) didn't finish. The phone likely ran out of memory. Try ${job.dpi > 200 ? '200 ppi' : 'a smaller size'}, or Settings → Small pieces.`, 12000), 600);
})();
window.EnlargerDebug = { S, run, sample, target, cropRect, exportFile };

refresh();
if (new URLSearchParams(location.search).has('selftest')) {
  (async () => {
    await sample();
    S.mode = 'classic'; S.size = 'cp'; S.cpW = 3000; S.cpH = 4500; S.cap = 2; S.sharpen = 30;
    refresh(); await run();
    const r = S.result, b = new Uint8Array(await S.blob.arrayBuffer());
    document.body.setAttribute('data-selftest', JSON.stringify({ W: r.W, H: r.H, size: S.blob.size, q: r.q, fits: r.fits, jfif: [b[13], (b[14] << 8) | b[15]], px: Array.from(r.buf.subarray(0, 8)) }));
  })().catch(e => document.body.setAttribute('data-selftest', 'ERR ' + e.message));
}
