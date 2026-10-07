import { CONSONANTS, SEED, SOUNDS, initialOf, imgKey, withRo, hasFinal, topic } from './seed.js';

const $app = document.getElementById('app');

const state = {
  screen: 'setup', // setup | loading | play
  consonant: null,
  count: 3,
  slides: [],
  idx: 0,
  toast: '',
  sound: true,
};
const used = new Set(); // 이번 접속에서 이미 나온 단어 (새 문제 만들 때 겹침 방지)

/* ------------------------------------------------------------------ */
/* 유틸                                                                */
/* ------------------------------------------------------------------ */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ALL_SEED = Object.entries(SEED).flatMap(([c, list]) => list.map((x) => ({ ...x, c })));
const EMOJI = new Map(ALL_SEED.map((x) => [x.word, x.emoji]));
const emojiOf = (word, fallback) => EMOJI.get(word) || fallback || '🖼️';

function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.rate = 0.8;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* 음성 미지원 */ }
}

let toastTimer;
function toast(msg) {
  state.toast = msg; render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = ''; render(); }, 4500);
}

/* ------------------------------------------------------------------ */
/* 정답 연출: 소리 + 색종이 + 칭찬 말                                   */
/* ------------------------------------------------------------------ */
let audioCtx;
function tone(freqs, step = 0.13, type = 'triangle', vol = 0.18) {
  if (!state.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = type; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      const s = t0 + i * step;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(vol, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + step * 1.8);
      o.start(s); o.stop(s + step * 1.9);
    });
  } catch { /* 소리 미지원 */ }
}
const ding = () => tone([784, 988, 1319]); // 딩-동-댕
const pop = () => tone([880, 1175], 0.1); // 자음이 나올 때 짧은 소리
const softNo = () => tone([330, 262], 0.16, 'sine', 0.12); // 부드러운 아쉬움

const PRAISE = ['딩동댕! 맞았어요 🎉', '우와, 대단해요! 👏', '정답이에요! 최고예요 ⭐', '잘했어요! 짝짝짝 👏', '척척박사네요! 🌟'];
const CONFETTI = ['#ffd43b', '#f0566b', '#3db07a', '#4aa8d8', '#ff9f43'];

function celebrate(big) {
  ding();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const n = big ? 54 : 20;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.cssText = `--x:${(Math.random() * 2 - 1) * 46}vw;--y:${-(18 + Math.random() * 40)}vh;--r:${Math.round(Math.random() * 720 - 360)}deg;--d:${(1 + Math.random() * 0.9).toFixed(2)}s;background:${CONFETTI[i % CONFETTI.length]}`;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2200);
}

/* ------------------------------------------------------------------ */
/* 서버 호출                                                           */
/* ------------------------------------------------------------------ */
async function api(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-passcode': localStorage.getItem('passcode') || '' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`api ${r.status}`);
  return r.json();
}

let codeAsk = null; // 세 단계가 동시에 401을 받아도 입력창은 한 번만
function askCode() {
  if (!codeAsk) {
    codeAsk = Promise.resolve().then(() => {
      const c = prompt('교사용 코드를 입력해 주세요');
      if (c) localStorage.setItem('passcode', c);
      return !!c;
    }).finally(() => { codeAsk = null; });
  }
  return codeAsk;
}

/* ------------------------------------------------------------------ */
/* 그림: 저장된 그림 → 이 기기 캐시 → AI 생성 → 이모지                  */
/* ------------------------------------------------------------------ */
const memImg = new Map();
const pending = new Map();
const failedAt = new Map(); // 생성 실패한 단어는 1분 동안 다시 시도하지 않음

const dbp = new Promise((resolve) => {
  try {
    const rq = indexedDB.open('chosori', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('img');
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => resolve(null);
  } catch { resolve(null); }
});
async function idbGet(k) {
  const db = await dbp; if (!db) return null;
  return new Promise((r) => { const q = db.transaction('img').objectStore('img').get(k); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); });
}
async function idbSet(k, v) {
  const db = await dbp; if (!db) return;
  try { db.transaction('img', 'readwrite').objectStore('img').put(v, k); } catch { /* 무시 */ }
}
const tryLoad = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(src); im.onerror = () => res(null); im.src = src; });

// 저장된 그림(배포 파일 / 이 기기)만 찾아봅니다. AI 호출 없음 → 비용 0, 아주 빠름
async function loadCached(word) {
  if (memImg.has(word)) return memImg.get(word);
  const key = imgKey(word);
  const url = (await tryLoad(`./images/${key}.jpg`)) || (await idbGet(key));
  if (url) memImg.set(word, url);
  return url || null;
}

function getImage(word) {
  if (memImg.has(word)) return Promise.resolve(memImg.get(word));
  if (pending.has(word)) return pending.get(word);
  const p = (async () => {
    let url = await loadCached(word);
    if (!url && Date.now() - (failedAt.get(word) || 0) > 60000) {
      try { url = (await api('/api/image', { word })).image; idbSet(imgKey(word), url); }
      catch { url = null; failedAt.set(word, Date.now()); }
    }
    if (url) memImg.set(word, url);
    pending.delete(word);
    return url;
  })();
  pending.set(word, p);
  return p;
}

// 그림 준비 줄: 지금 보는 쪽이 먼저, 동시에 3장까지
const queue = [];
let running = 0;
function enqueue(words, front = false) {
  for (const w of front ? [...words].reverse() : words) {
    if (!w || memImg.has(w)) continue;
    const i = queue.indexOf(w); if (i >= 0) queue.splice(i, 1);
    front ? queue.unshift(w) : queue.push(w);
  }
  pump();
}
function pump() {
  while (running < 3 && queue.length) {
    const w = queue.shift(); running++;
    getImage(w).finally(() => { running--; pump(); });
  }
}
const wordsOf = (s) => (!s ? [] : s.type === 'l3' ? s.opts.map((o) => o.word) : s.d ? [s.d.word] : []);

function picHTML(word, emoji, extra = '') {
  const u = memImg.get(word);
  const failed = Date.now() - (failedAt.get(word) || 0) < 60000;
  const inner = u ? `<img alt="${esc(word)}" src="${u}">`
    : failed ? `<span class="emoji">${esc(emoji)}</span>` // 그림을 못 만들었을 때만 이모지로 대신
    : `<span class="drawing">그림 그리는 중…</span>`;
  return `<div class="pic ${extra}" data-word="${esc(word)}" data-emoji="${esc(emoji)}">${inner}</div>`;
}
function hydrate() {
  document.querySelectorAll('.pic[data-word]').forEach((el) => {
    if (el.querySelector('img') || el.querySelector('.emoji')) return;
    const w = el.dataset.word;
    getImage(w).then((u) => {
      if (!el.isConnected) return;
      if (u) el.innerHTML = `<img alt="${esc(w)}" src="${u}">`;
      else el.innerHTML = `<span class="emoji">${esc(el.dataset.emoji || '')}</span>`;
    });
  });
}

/* ------------------------------------------------------------------ */
/* 문제 만들기: 3단계를 동시에 요청 → 검증 → 부족하면 저장된 문제로 채우기 */
/* ------------------------------------------------------------------ */
const isHangul = (s) => typeof s === 'string' && /^[가-힣]{1,8}$/.test(s);
const good = (c, w) => isHangul(w) && initialOf(w) === c;
const uniq = (arr) => { const s = new Set(); return arr.filter((x) => (s.has(x.word) ? false : s.add(x.word))); };

function cleanRaw(level, c, items) {
  const src = Array.isArray(items) ? items : [];
  if (level === 1) return uniq(src.filter((x) => good(c, x.word)).map((x) => ({ word: x.word, emoji: emojiOf(x.word, x.emoji) })));
  if (level === 2) {
    return uniq(src.filter((x) => good(c, x.word) && typeof x.riddle === 'string' && x.riddle.trim() && !x.riddle.includes(x.word))
      .map((x) => ({ word: x.word, emoji: emojiOf(x.word, x.emoji), riddle: x.riddle.trim() })));
  }
  return uniq(src.filter((x) => good(c, x.word) && isHangul(x.distractor) && initialOf(x.distractor) !== c)
    .map((x) => ({ word: x.word, emoji: emojiOf(x.word, x.emoji), distractor: x.distractor, distractorEmoji: emojiOf(x.distractor, x.distractorEmoji) })));
}

const clean = (level, c, items) => [...cleanRaw(level, c, items)].sort((a, b) => hasFinal(a.word) - hasFinal(b.word));

function fillLevel(level, c, count, list) {
  const out = [...list];
  const have = new Set(out.map((x) => x.word));
  const others = ALL_SEED.filter((x) => x.c !== c);
  for (const s of shuffle(SEED[c])) {
    if (out.length >= count) break;
    if (have.has(s.word)) continue;
    have.add(s.word);
    if (level === 1) out.push({ word: s.word, emoji: s.emoji });
    else if (level === 2) out.push({ word: s.word, emoji: s.emoji, riddle: s.riddle });
    else { const o = shuffle(others)[0]; out.push({ word: s.word, emoji: s.emoji, distractor: o.word, distractorEmoji: o.emoji }); }
  }
  return out.slice(0, count);
}

function makeSlides(level, list) {
  if (level === 3) {
    return list.map((d) => ({
      type: 'l3', revealed: false, picked: null, praise: '',
      opts: shuffle([{ word: d.word, emoji: d.emoji, correct: true }, { word: d.distractor, emoji: d.distractorEmoji, correct: false }]),
    }));
  }
  return list.map((d) => ({ type: `l${level}`, d, revealed: false, initShown: false, step: 0 }));
}

async function fetchLevel(c, count, level) {
  try {
    const body = { consonant: c, count, level, known: SEED[c].map((x) => x.word), exclude: [...used].slice(-60) };
    if (level === 3) body.pool = shuffle(ALL_SEED.filter((x) => x.c !== c)).slice(0, 40).map((x) => x.word);
    const j = await api('/api/question', body);
    return { items: j.items || [] };
  } catch (e) { return { err: e.message === 'api 401' ? 'auth' : 'other' }; }
}

// 자음을 누르는 순간 미리 요청을 시작해 두면, '놀이 시작'을 누를 때쯤 이미 도착해 있습니다.
const warmCache = new Map();
function warm(c, count, fresh = false) {
  const key = `${c}|${count}`;
  const hit = warmCache.get(key);
  if (!fresh && hit && Date.now() - hit.t < 10 * 60 * 1000) return hit;
  const entry = { t: Date.now(), results: [null, null, null], proms: [] };
  entry.proms = [1, 2, 3].map((lv, i) => fetchLevel(c, count, lv).then((r) => { entry.results[i] = r; return r; }));
  warmCache.set(key, entry);
  return entry;
}
function warmImages(c) { SEED[c].forEach((x) => loadCached(x.word)); }

const WAIT_MS = 3000; // 이 시간 안에 못 오면 저장된 문제로 먼저 시작하고, 도착하면 아직 안 본 단계에 바꿔 넣음

async function build(fresh = false) {
  const c = state.consonant; const count = state.count;
  state.screen = 'loading'; render();
  let entry = warm(c, count, fresh);
  await Promise.race([Promise.all(entry.proms), sleep(WAIT_MS)]);
  if (entry.results.some((r) => r?.err === 'auth')) { // 교사용 코드가 필요한 경우
    if (await askCode()) { entry = warm(c, count, true); await Promise.race([Promise.all(entry.proms), sleep(WAIT_MS)]); }
  }
  warmCache.delete(`${c}|${count}`); // 한 번 쓴 문제는 다시 쓰지 않음

  const lists = [1, 2, 3].map((lv, i) => {
    const r = entry.results[i];
    return fillLevel(lv, c, count, r?.items ? clean(lv, c, r.items) : []);
  });
  const failed = entry.results.some((r) => r?.err);
  lists.flat().forEach((x) => { used.add(x.word); if (x.distractor) used.add(x.distractor); });

  state.slides = [...makeSlides(1, lists[0]), ...makeSlides(2, lists[1]), ...makeSlides(3, lists[2])];
  state.idx = 0; state.screen = 'play';
  render();
  enqueue(state.slides.flatMap(wordsOf));
  if (failed) toast('AI 연결이 어려워 저장된 문제로 진행해요');

  // 늦게 도착한 단계는, 아직 시작하지 않았다면 새 문제로 바꿔 넣기
  entry.proms.forEach((p, i) => {
    if (entry.results[i]) return;
    p.then((r) => { if (r?.items) swapLate(i + 1, fillLevel(i + 1, c, count, clean(i + 1, c, r.items))); });
  });
}

function swapLate(level, list) {
  if (state.screen !== 'play') return;
  const type = `l${level}`;
  const at = state.slides.map((s, i) => (s.type === type ? i : -1)).filter((i) => i >= 0);
  if (!at.length || at[0] <= state.idx || at.some((i) => state.slides[i].revealed || state.slides[i].picked !== null)) return;
  const fresh = makeSlides(level, list);
  at.forEach((pos, k) => { if (fresh[k]) state.slides[pos] = fresh[k]; });
  list.forEach((x) => { used.add(x.word); if (x.distractor) used.add(x.distractor); });
  enqueue(fresh.flatMap(wordsOf));
}

/* ------------------------------------------------------------------ */
/* 화면 그리기                                                         */
/* ------------------------------------------------------------------ */
const PHASES = [
  { id: 'l1', label: '① 그림 보고 첫소리' },
  { id: 'l2', label: '② 수수께끼' },
  { id: 'l3', label: '③ 둘 중 고르기' },
];
const cur = () => state.slides[state.idx];
const NAME = Object.fromEntries(CONSONANTS.map((x) => [x.c, x.name]));
const roName = (c) => (NAME[c] === '리을' ? '로' : '으로');
const startSentence = (s, c) => `${s.d.word}${topic(s.d.word)} ${NAME[c]}${roName(c)} 시작해요`;
const soundSentence = (c) => (SOUNDS[c] ? `${NAME[c]}은 ${SOUNDS[c]} 소리가 나요` : `${NAME[c]}은 소리가 없는 친구예요. 바로 모음 소리가 나요`);
const soundEcho = (s, c) => (SOUNDS[c] ? `${SOUNDS[c]}, ${SOUNDS[c]}, ${s.d.word}` : soundSentence(c));
const soundLabel = (c) => (SOUNDS[c] ? `‘${SOUNDS[c]}’ 소리 듣기` : '소리 안내 듣기');

function renderSetup() {
  return `
  <main class="setup">
    <h1 aria-label="첫소리 놀이터"><span class="tile">첫</span><span class="tile">소</span><span class="tile">리</span>&nbsp;놀이터</h1>
    <p class="sub">오늘 놀이할 자음을 골라 주세요</p>
    <div class="grid14">
      ${CONSONANTS.map((x) => `<button class="cons ${state.consonant === x.c ? 'on' : ''}" data-act="pick-c" data-c="${x.c}">${x.c}<small>${x.name}</small></button>`).join('')}
    </div>
    <div class="opt-row">단계별 문제 수
      ${[3, 4, 5].map((n) => `<button class="pill ${state.count === n ? 'on' : ''}" data-act="count" data-n="${n}">${n}개</button>`).join('')}
    </div>
    <button class="btn primary go" data-act="start" ${state.consonant ? '' : 'disabled'}>놀이 시작</button>
  </main>`;
}

function renderLoading() {
  return `<div class="loading-screen"><div>‘${esc(state.consonant)}’ 문제를 만들고 있어요<br><span class="dots"><span>●</span><span>●</span><span>●</span></span></div></div>`;
}

function wordWithHL(word) {
  const [first, ...rest] = [...word];
  return `<b>${esc(first)}</b>${esc(rest.join(''))}`;
}

function renderSlide(s) {
  const c = state.consonant;
  if (s.type === 'l1') {
    const d = s.d;
    const sound = SOUNDS[c];
    const chip = s.step === 0 ? '그림을 보고 이름을 말해 볼까요?'
      : s.step === 1 ? `‘${d.word}’${topic(d.word)} ‘${c}’${withRo(c).slice(1)} 시작해요!`
      : sound ? `‘${c}’은 ‘${sound}’ 소리가 나요` : `‘${c}’은 소리가 없는 친구예요`;
    const answer = s.step === 0
      ? `<div class="answer"><div class="word" aria-hidden="true">？</div></div>`
      : s.step === 1
        ? `<div class="answer"><div class="init">${esc(c)}</div><div class="word">${wordWithHL(d.word)}</div></div>`
        : `<div class="answer"><div class="init">${esc(c)}</div><div class="arrow">→</div>${sound ? `<div class="snd">${esc(sound)}</div>` : `<div class="snd mute">소리 없음</div>`}<div class="word">${wordWithHL(d.word)}</div></div>`;
    return `<div class="stage">
      <div class="q-chip">${esc(chip)}</div>
      <div class="row">${picHTML(d.word, d.emoji)}${answer}</div>
      <div class="tools">
        <button class="btn small" data-act="say-word">🔊 소리 듣기</button>
        ${s.step === 1 ? `<button class="btn small" data-act="say-start">🔊 ${esc(c)}${roName(c) === '로' ? '로' : '으로'} 시작해요</button>` : ''}
        ${s.step === 2 ? `<button class="btn small" data-act="say-sound">🔊 ${esc(soundLabel(c))}</button>` : ''}
      </div>
    </div>`;
  }
  if (s.type === 'l2') {
    const d = s.d;
    const chip = !s.revealed ? '수수께끼' : s.initShown ? `‘${c}’${withRo(c).slice(1)} 시작해요!` : '어떤 자음으로 시작할까요?';
    return `<div class="stage">
      <div class="q-chip">${esc(chip)}</div>
      <div class="riddle">${esc(d.riddle)}</div>
      <div class="row">
        ${s.revealed ? picHTML(d.word, d.emoji) : `<div class="pic mystery"><span>?</span></div>`}
        ${s.revealed ? `<div class="answer">
          ${s.initShown ? `<div class="init">${esc(c)}</div>` : `<button class="init ask" data-act="show-init" aria-label="자음 보기">?</button>`}
          <div class="word">${s.initShown ? wordWithHL(d.word) : esc(d.word)}</div></div>` : ''}
      </div>
      <div class="tools">
        <button class="btn small" data-act="say-riddle">🔊 문제 읽어 주기</button>
        ${s.revealed ? `<button class="btn small" data-act="say-word">🔊 정답 듣기</button>` : ''}
        ${s.initShown ? `<button class="btn small" data-act="say-sound">🔊 ${esc(soundLabel(c))}</button>` : ''}
      </div>
    </div>`;
  }
  if (s.type === 'l3') {
    const wrong = s.picked !== null && !s.opts[s.picked].correct;
    const msg = wrong ? '앗, 다시 한번 생각해 볼까요?' : s.revealed ? (s.praise || PRAISE[0]) : '';
    return `<div class="stage">
      <div class="q-chip">‘${esc(c)}’${withRo(c).slice(1)} 시작하는 것은 어느 쪽일까요?</div>
      <div class="cards">
        ${s.opts.map((o, i) => {
          const showLabel = s.revealed || s.picked === i;
          const cls = s.picked === i ? (o.correct ? 'ok' : 'no') : (s.revealed && o.correct ? 'ok' : '');
          return `<button class="card ${cls}" data-act="pick-card" data-i="${i}">${picHTML(o.word, o.emoji)}<div class="label">${showLabel ? esc(o.word) : '&nbsp;'}</div></button>`;
        }).join('')}
      </div>
      <div class="msg ${wrong ? '' : 'good'}">${msg}</div>
    </div>`;
  }
  return '';
}

function primaryLabel(s) {
  if (s.type === 'l1' && s.step === 0) return '첫소리 보기';
  if (s.type === 'l1' && s.step === 1) return '소리 알아보기';
  if (s.type === 'l2' && s.revealed && !s.initShown) return '자음 보기';
  if (['l2', 'l3'].includes(s.type) && !s.revealed) return '정답 보기';
  return state.idx === state.slides.length - 1 ? '처음으로' : '다음 ▶';
}

function renderPlay() {
  const s = cur();
  const phaseIdx = PHASES.findIndex((p) => p.id === s.type);
  return `
  <header class="bar">
    <button class="btn small" data-act="home" aria-label="처음 화면으로">🏠</button>
    <div class="badge">${esc(state.consonant)}</div>
    <nav class="tabs">${PHASES.map((p, i) => `<button class="tab ${i === phaseIdx ? 'on' : ''}" data-act="jump" data-p="${p.id}">${p.label}</button>`).join('')}</nav>
    <button class="btn small" data-act="sound" aria-label="소리 켜기/끄기">${state.sound ? '🔔' : '🔕'}</button>
    <button class="btn small" data-act="regen">🔄 새 문제</button>
  </header>
  <section class="stage-wrap">${renderSlide(s)}</section>
  <footer class="foot">
    <button class="btn" data-act="prev" ${state.idx === 0 ? 'disabled' : ''}>◀ 이전</button>
    <div class="dots" aria-hidden="true">${state.slides.map((_, i) => `<span class="dot ${i === state.idx ? 'on' : i < state.idx ? 'done' : ''}"></span>`).join('')}</div>
    <button class="btn primary" data-act="next">${primaryLabel(s)}</button>
  </footer>`;
}

function render() {
  $app.innerHTML =
    (state.screen === 'setup' ? renderSetup() : state.screen === 'loading' ? renderLoading() : renderPlay()) +
    (state.toast ? `<div class="toast" role="status">${esc(state.toast)}</div>` : '');
  hydrate();
  if (state.screen === 'play') enqueue([...wordsOf(cur()), ...wordsOf(state.slides[state.idx + 1])], true); // 지금과 다음 장 그림부터
}

/* ------------------------------------------------------------------ */
/* 동작                                                                */
/* ------------------------------------------------------------------ */
function next() {
  const s = cur();
  const c = state.consonant;
  if (s.type === 'l1' && s.step < 2) {
    s.step++; s.revealed = true;
    if (s.step === 1) { celebrate(false); speak(startSentence(s, c)); } else { pop(); speak(soundSentence(c)); }
    return render();
  }
  if (s.type === 'l2' && s.revealed && !s.initShown) { s.initShown = true; pop(); return render(); }
  if (['l2', 'l3'].includes(s.type) && !s.revealed) {
    s.revealed = true;
    if (s.type === 'l3') s.praise = PRAISE[Math.floor(Math.random() * PRAISE.length)];
    celebrate(false);
    if (s.type !== 'l3') speak(s.d.word);
    return render();
  }
  if (state.idx < state.slides.length - 1) { state.idx++; return render(); }
  state.screen = 'setup'; render();
}
const prev = () => { if (state.idx > 0) { state.idx--; render(); } };

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const s = state.screen === 'play' ? cur() : null;
  switch (act) {
    case 'pick-c': state.consonant = el.dataset.c; warm(state.consonant, state.count); warmImages(state.consonant); render(); break;
    case 'count': state.count = Number(el.dataset.n); if (state.consonant) warm(state.consonant, state.count); render(); break;
    case 'start': if (state.consonant) build(false); break;
    case 'regen': if (state.consonant) build(true); break;
    case 'home': state.screen = 'setup'; render(); break;
    case 'sound': state.sound = !state.sound; render(); break;
    case 'next': next(); break;
    case 'prev': prev(); break;
    case 'jump': { const i = state.slides.findIndex((x) => x.type === el.dataset.p); if (i >= 0) { state.idx = i; render(); } break; }
    case 'show-init': if (s.type === 'l2' && s.revealed && !s.initShown) { s.initShown = true; pop(); render(); } break;
    case 'say-start': speak(startSentence(s, state.consonant)); break;
    case 'say-sound': speak(soundEcho(s, state.consonant)); break;
    case 'say-word': speak(s.d.word); break;
    case 'say-riddle': speak(s.d.riddle); break;
    case 'pick-card': {
      if (s.revealed) break;
      const i = Number(el.dataset.i);
      s.picked = i;
      if (s.opts[i].correct) {
        s.revealed = true;
        s.praise = PRAISE[Math.floor(Math.random() * PRAISE.length)];
        celebrate(true);
        setTimeout(() => speak(s.opts[i].word), 450); // 딩동댕 뒤에 단어 읽어 주기
        render();
      } else {
        softNo();
        speak(s.opts[i].word);
        render();
        setTimeout(() => { if (s.picked === i && !s.revealed) { s.picked = null; render(); } }, 1400);
      }
      break;
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (state.screen !== 'play') return;
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
    if (e.target.closest?.('button') && e.key !== 'ArrowRight') return; // 버튼 기본 동작 유지
    e.preventDefault(); next();
  } else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
});

render();
