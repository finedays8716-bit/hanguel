// 악어 게임: 떨어지는 자음 중 오늘의 자음만 먹어요. 전자칠판 터치용.
import { CONSONANTS, SEED, SOUNDS } from './seed.js';

const GOAL = 10; // 오늘의 자음을 이만큼 먹으면 끝
const SPEEDS = {
  slow: { fall: 0.15, gap: 2300 },
  normal: { fall: 0.22, gap: 1750 },
  fast: { fall: 0.31, gap: 1300 },
};
// 소리나 모양이 헷갈리는 자음은 방해 자음에서 뺍니다 (3세에게는 너무 어려워요)
const CONF = {
  'ㄱ': ['ㅋ', 'ㄴ'], 'ㄴ': ['ㄱ', 'ㄷ', 'ㄹ'], 'ㄷ': ['ㅌ', 'ㄴ', 'ㄹ'], 'ㄹ': ['ㄷ', 'ㅁ', 'ㄴ'],
  'ㅁ': ['ㅇ', 'ㅂ', 'ㄹ'], 'ㅂ': ['ㅍ', 'ㅁ'], 'ㅅ': ['ㅈ', 'ㅊ'], 'ㅇ': ['ㅁ', 'ㅎ'],
  'ㅈ': ['ㅊ', 'ㅅ'], 'ㅊ': ['ㅈ', 'ㅅ'], 'ㅋ': ['ㄱ'], 'ㅌ': ['ㄷ', 'ㅍ'], 'ㅍ': ['ㅂ', 'ㅌ'], 'ㅎ': ['ㅇ'],
};
const COLORS = ['#ffd43b', '#ffffff', '#a8e0c0', '#ffc6cf', '#bfe3f5'];
const INK = '#1f3347';
const FONT = '"Jua","Gowun Dodum","Malgun Gothic","Apple SD Gothic Neo",sans-serif';

const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const rand = (a, b) => a + Math.random() * (b - a);

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function startGame(root, { consonant: c, speed = 'normal', api, onExit }) {
  const NAME = Object.fromEntries(CONSONANTS.map((x) => [x.c, x.name]));
  const sp = SPEEDS[speed] || SPEEDS.normal;
  const decoys = shuffle(CONSONANTS.map((x) => x.c).filter((x) => x !== c && !(CONF[c] || []).includes(x))).slice(0, 3);
  const words = SEED[c].map((x) => x.word);

  root.innerHTML = `
  <header class="bar gbar">
    <button class="btn small" data-g="home" aria-label="처음 화면으로">🏠</button>
    <div class="badge">${c}</div>
    <div class="gtitle">‘${c}’만 먹어요!</div>
    <div class="gprog" id="gprog" aria-live="polite"></div>
    <button class="btn small" data-g="sound" aria-label="소리 켜기/끄기">${api.getSound() ? '🔔' : '🔕'}</button>
    <button class="btn small" data-g="restart">🔄 다시</button>
  </header>
  <section class="gwrap">
    <canvas class="gcanvas" aria-label="악어 게임 화면"></canvas>
    <div class="govl" id="govl"></div>
  </section>`;

  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const ovl = root.querySelector('#govl');
  const prog = root.querySelector('#gprog');

  let W = 0; let H = 0; let S = 60; let raf = 0; let last = 0; let wordIdx = 0;
  const G = {
    running: false, done: false, score: 0, wrong: 0, x: 0, tx: 0, mood: 'happy', moodT: 0, chew: 0,
    letters: [], fx: [], spawnT: 600, sinceTarget: 0, lastSpawnX: -1, say: null, t: 0,
  };
  canvas.__game = G; // 확인용

  /* ----- 크기 ----- */
  const geo = () => ({
    crocW: S * 2.6, headTop: H * 0.68, mouthRx: S * 0.95 * 1.0,
  });
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const kx = W ? r.width / W : 1; const ky = H ? r.height / H : 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = Math.min(H * 0.15, W * 0.1);
    G.x *= kx; G.tx *= kx;
    G.letters.forEach((l) => { l.x *= kx; l.y *= ky; });
    if (!G.x) { G.x = W / 2; G.tx = W / 2; }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  /* ----- 조작: 손가락(또는 마우스)이 있는 가로 위치로 악어가 따라와요 ----- */
  const setTarget = (clientX) => {
    const r = canvas.getBoundingClientRect();
    const m = geo().crocW * 0.45;
    G.tx = Math.max(m, Math.min(W - m, clientX - r.left));
  };
  const onPointer = (e) => { if (G.running) setTarget(e.clientX); };
  canvas.addEventListener('pointerdown', (e) => { try { canvas.setPointerCapture(e.pointerId); } catch { /* 무시 */ } onPointer(e); });
  canvas.addEventListener('pointermove', onPointer);
  const onKey = (e) => {
    if (!G.running) return;
    if (e.key === 'ArrowLeft') { G.tx = Math.max(S, G.tx - W * 0.08); e.preventDefault(); }
    if (e.key === 'ArrowRight') { G.tx = Math.min(W - S, G.tx + W * 0.08); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);

  /* ----- 진행 표시 ----- */
  const renderProg = () => {
    prog.innerHTML = Array.from({ length: GOAL }, (_, i) => `<span class="gdot ${i < G.score ? 'on' : ''}">${c}</span>`).join('');
  };

  /* ----- 게임 규칙 ----- */
  function spawn() {
    const isTarget = G.sinceTarget >= 2 || Math.random() < 0.5;
    G.sinceTarget = isTarget ? 0 : G.sinceTarget + 1;
    let x = rand(S, W - S);
    for (let i = 0; i < 6 && Math.abs(x - G.lastSpawnX) < S * 1.7; i++) x = rand(S, W - S);
    G.lastSpawnX = x;
    G.letters.push({
      x, y: -S, vy: H * sp.fall * rand(0.92, 1.08), ch: isTarget ? c : decoys[Math.floor(Math.random() * decoys.length)],
      isTarget, rot: rand(-0.2, 0.2), sway: rand(0, 6), color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }

  function eat(l) {
    G.letters = G.letters.filter((x) => x !== l);
    if (l.isTarget) {
      G.score++; G.chew = 0.25; G.mood = 'happy'; G.moodT = 0.7;
      G.fx.push({ kind: 'swallow', ch: l.ch, x: l.x, y: l.y, color: l.color, rot: l.rot, t: 0, life: 0.22 });
      for (let i = 0; i < 9; i++) G.fx.push({ kind: 'spark', x: G.x, y: geo().headTop, vx: rand(-260, 260), vy: rand(-420, -120), t: 0, life: rand(0.5, 0.9) });
      const w = words[wordIdx++ % words.length];
      G.say = { text: w, t: 0, life: 1.4 };
      api.tone([392, 262], 0.06, 'square', 0.07); // 냠
      const s = SOUNDS[c];
      api.speak(s ? `${s}, ${w}` : w); // 먹을 때마다 자음 소리 + 단어
      renderProg();
      if (G.score >= GOAL) finish();
    } else {
      G.wrong++; G.mood = 'yuck'; G.moodT = 0.95; G.chew = 0;
      G.fx.push({ kind: 'spit', ch: l.ch, x: l.x, y: l.y, vx: rand(-1, 1) > 0 ? rand(260, 420) : -rand(260, 420), vy: -rand(260, 380), color: l.color, rot: l.rot, t: 0, life: 0.9 });
      G.say = { text: '퉤!', t: 0, life: 0.9 };
      api.tone([180], 0.22, 'sawtooth', 0.1); // 삐-
    }
  }

  function update(dt) {
    G.t += dt;
    G.x += (G.tx - G.x) * Math.min(1, 14 * dt);
    if (G.moodT > 0) { G.moodT -= dt; if (G.moodT <= 0) G.mood = 'happy'; }
    if (G.chew > 0) G.chew = Math.max(0, G.chew - dt);
    if (!G.done) {
      G.spawnT -= dt * 1000;
      if (G.spawnT <= 0 && G.letters.length < 3) { spawn(); G.spawnT = sp.gap * rand(0.85, 1.15); }
    }
    const { headTop, mouthRx } = geo();
    for (const l of [...G.letters]) {
      l.y += l.vy * dt;
      if (Math.abs(l.x - G.x) < mouthRx && l.y > headTop - S * 0.1 && l.y < headTop + S * 0.7) { eat(l); continue; }
      if (l.y > H + S) G.letters = G.letters.filter((x) => x !== l);
    }
    for (const f of G.fx) {
      f.t += dt;
      if (f.kind === 'spark' || f.kind === 'spit') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 900 * dt; }
    }
    G.fx = G.fx.filter((f) => f.t < f.life);
    if (G.say) { G.say.t += dt; if (G.say.t > G.say.life) G.say = null; }
  }

  /* ----- 그리기 ----- */
  function drawTile(ch, x, y, rot, color, scale = 1, alpha = 1) {
    const s = S * scale;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = INK; rr(ctx, -s / 2 + s * 0.06, -s / 2 + s * 0.06, s, s, s * 0.22); ctx.fill();
    ctx.fillStyle = color; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(3, s * 0.05);
    rr(ctx, -s / 2, -s / 2, s, s, s * 0.22); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.font = `${Math.round(s * 0.66)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, 0, s * 0.04);
    ctx.restore();
  }

  function drawBackground() {
    ctx.fillStyle = '#d6eef6'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    [[0.15, 0.16, 1], [0.58, 0.1, 1.3], [0.85, 0.24, 0.8]].forEach(([fx, fy, k]) => {
      const x = W * fx + Math.sin(G.t * 0.15 + fx * 9) * 14; const y = H * fy; const r = H * 0.045 * k;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.arc(x + r * 1.2, y + r * 0.2, r * 0.85, 0, 7); ctx.arc(x - r * 1.2, y + r * 0.25, r * 0.75, 0, 7); ctx.fill();
    });
  }

  function drawCroc() {
    const { crocW, headTop } = geo();
    const x = G.x; const hw = crocW * 0.62;
    const yuck = G.mood === 'yuck';
    const col = yuck ? '#b7c94a' : '#3db07a'; const dark = yuck ? '#8ea03a' : '#2c8a5e';
    const lw = Math.max(3, H * 0.006);
    ctx.lineWidth = lw; ctx.strokeStyle = INK;
    // 몸통
    ctx.fillStyle = dark; rr(ctx, x - hw * 0.92, headTop + H * 0.02, hw * 1.84, H, hw * 0.3); ctx.fill();
    // 머리
    ctx.fillStyle = col; rr(ctx, x - hw, headTop, hw * 2, H - headTop + 40, hw * 0.35); ctx.fill(); ctx.stroke();
    // 등 무늬
    ctx.fillStyle = dark;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(x + i * hw * 0.55, headTop + H * 0.17, H * 0.014, 0, 7); ctx.fill(); }
    // 눈
    const er = H * 0.042;
    for (const sgn of [-1, 1]) {
      const ex = x + sgn * hw * 0.74; const ey = headTop - H * 0.004;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ex, ey, er, 0, 7); ctx.fill(); ctx.stroke();
      if (yuck) {
        ctx.lineWidth = lw * 1.4; ctx.beginPath(); // 꼭 감은 눈: 왼쪽 '>', 오른쪽 '<'
        if (sgn === -1) { ctx.moveTo(ex - er * 0.5, ey - er * 0.45); ctx.lineTo(ex + er * 0.45, ey); ctx.lineTo(ex - er * 0.5, ey + er * 0.45); }
        else { ctx.moveTo(ex + er * 0.5, ey - er * 0.45); ctx.lineTo(ex - er * 0.45, ey); ctx.lineTo(ex + er * 0.5, ey + er * 0.45); }
        ctx.stroke(); ctx.lineWidth = lw;
      } else {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, er * 0.72, 0, 7); ctx.fill();
        const look = Math.max(-1, Math.min(1, (G.tx - G.x) / (W * 0.15)));
        ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(ex + look * er * 0.18, ey - er * 0.12, er * 0.36, 0, 7); ctx.fill();
      }
    }
    // 입 (먹을 때 오물오물)
    const open = 1 - 0.6 * Math.max(0, G.chew / 0.25);
    const rx = hw * 0.8; const ry = H * 0.052 * (yuck ? 0.55 : open); const cy = headTop + H * 0.075;
    ctx.fillStyle = '#7a1f3d'; ctx.beginPath(); ctx.ellipse(x, cy, rx, ry, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff8fa3'; ctx.beginPath(); ctx.ellipse(x, cy + ry * 0.35, rx * 0.55, ry * 0.5, 0, 0, 7); ctx.fill();
    if (yuck) { ctx.beginPath(); ctx.ellipse(x, cy + ry + H * 0.018, rx * 0.2, H * 0.025, 0, 0, 7); ctx.fill(); ctx.stroke(); } // 혀를 쏙
    ctx.fillStyle = '#fff'; ctx.lineWidth = lw * 0.7;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const dx = (i - (n - 1) / 2) * (rx * 0.38); const k = Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2));
      const tw = rx * 0.1; const th = Math.max(ry * 0.5, H * 0.012);
      ctx.beginPath(); ctx.moveTo(x + dx - tw, cy - k * ry); ctx.lineTo(x + dx + tw, cy - k * ry); ctx.lineTo(x + dx, cy - k * ry + th); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + dx - tw, cy + k * ry); ctx.lineTo(x + dx + tw, cy + k * ry); ctx.lineTo(x + dx, cy + k * ry - th); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (!yuck) { ctx.fillStyle = 'rgba(255,120,140,0.45)'; for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + sgn * hw * 0.68, headTop + H * 0.15, H * 0.026, H * 0.016, 0, 0, 7); ctx.fill(); } }
  }

  function drawWater() {
    const y0 = H * 0.9;
    ctx.fillStyle = 'rgba(86,176,220,0.7)'; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 12) ctx.lineTo(x, y0 + Math.sin(x * 0.02 + G.t * 2) * H * 0.008);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }

  function drawFx() {
    for (const f of G.fx) {
      const p = f.t / f.life;
      if (f.kind === 'swallow') { // 입속으로 쏙
        const { headTop } = geo();
        drawTile(f.ch, f.x + (G.x - f.x) * p, f.y + (headTop + H * 0.07 - f.y) * p, f.rot, f.color, 1 - 0.85 * p, 1 - 0.3 * p);
      } else if (f.kind === 'spit') { // 퉤!
        drawTile(f.ch, f.x, f.y, f.rot + p * 3, f.color, 1, 1 - p);
      } else {
        ctx.globalAlpha = 1 - p; ctx.fillStyle = '#ffd43b'; ctx.beginPath(); ctx.arc(f.x, f.y, H * 0.012 * (1 - p * 0.5) + 2, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    if (G.say) {
      const p = G.say.t / G.say.life; const { headTop } = geo();
      ctx.save(); ctx.globalAlpha = Math.min(1, (1 - p) * 2.2);
      ctx.font = `${Math.round(H * 0.085)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const y = headTop - H * 0.1 - p * H * 0.05; const w = G.say.text;
      ctx.lineWidth = H * 0.016; ctx.strokeStyle = '#fff'; ctx.strokeText(w, G.x, y);
      ctx.fillStyle = G.say.text === '퉤!' ? '#f0566b' : INK; ctx.fillText(w, G.x, y);
      ctx.restore();
    }
  }

  function draw() {
    if (!W) return;
    drawBackground();
    for (const l of G.letters) drawTile(l.ch, l.x + Math.sin(G.t * 3 + l.sway) * S * 0.06, l.y, l.rot + Math.sin(G.t * 2 + l.sway) * 0.08, l.color);
    drawCroc();
    drawFx();
    drawWater();
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    if (G.running) update(dt); else G.t += dt;
    draw();
  }

  /* ----- 시작 / 끝 안내 화면 ----- */
  function showIntro() {
    ovl.innerHTML = `<div class="gcard">
      <div class="gtile">${c}</div>
      <div class="gh">‘${c}’만 먹어요!</div>
      <p>다른 자음이 떨어지면 퉤! 하고 뱉어요.<br>손가락으로 악어를 좌우로 움직여 보세요.</p>
      <button class="btn primary" data-g="start">시작</button></div>`;
    ovl.hidden = false;
    api.speak(`${NAME[c]}만 먹어요`);
  }
  function finish() {
    G.done = true; G.running = false;
    setTimeout(() => {
      ovl.innerHTML = `<div class="gcard">
        <div class="gstars" aria-hidden="true">⭐⭐⭐</div>
        <div class="gh">참 잘했어요!</div>
        <p>‘${c}’을 ${GOAL}개나 먹었어요!</p>
        <div class="grow"><button class="btn primary" data-g="again">🔄 한 번 더</button><button class="btn" data-g="home">🏠 처음으로</button></div></div>`;
      ovl.hidden = false;
      api.celebrate(true);
      api.speak('참 잘했어요');
    }, 700);
  }
  function reset(run) {
    G.letters = []; G.fx = []; G.score = 0; G.wrong = 0; G.done = false; G.say = null; G.sinceTarget = 0; G.spawnT = 700; G.mood = 'happy'; G.chew = 0; wordIdx = 0;
    renderProg();
    G.running = run; ovl.hidden = run;
  }

  /* ----- 버튼 ----- */
  const stop = () => {
    cancelAnimationFrame(raf); ro.disconnect();
    document.removeEventListener('keydown', onKey); root.removeEventListener('click', onClick);
    try { speechSynthesis.cancel(); } catch { /* 무시 */ }
  };
  function onClick(e) {
    const b = e.target.closest('[data-g]'); if (!b) return;
    const a = b.dataset.g;
    if (a === 'home') { stop(); onExit(); }
    else if (a === 'start' || a === 'again') { reset(true); api.tone([523, 659], 0.09, 'triangle', 0.1); }
    else if (a === 'restart') { reset(false); showIntro(); }
    else if (a === 'sound') { b.textContent = api.toggleSound() ? '🔔' : '🔕'; }
  }
  root.addEventListener('click', onClick);

  /* ----- 시작 ----- */
  renderProg();
  resize();
  showIntro();
  raf = requestAnimationFrame(frame);
  return stop;
}
