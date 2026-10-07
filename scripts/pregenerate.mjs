// 기본 단어 그림을 미리 만들어 public/images 에 저장합니다. (한 번만 실행하면 됩니다)
// 사용법:  OPENAI_API_KEY=sk-... node scripts/pregenerate.mjs
// 이미 있는 그림은 건너뛰므로 중간에 멈춰도 다시 실행하면 이어서 만듭니다.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { SEED, imgKey } from '../public/seed.js';
import { generateImage } from '../lib/common.js';

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY 환경변수를 먼저 설정해 주세요.');
  process.exit(1);
}

const dir = new URL('../public/images/', import.meta.url);
await mkdir(dir, { recursive: true });

const words = [...new Set(Object.values(SEED).flat().map((x) => x.word))];
let made = 0;
for (const [i, word] of words.entries()) {
  const file = new URL(`${imgKey(word)}.jpg`, dir);
  try { await access(file); console.log(`(${i + 1}/${words.length}) ${word} — 이미 있음`); continue; } catch {}
  try {
    const b64 = await generateImage(word, key);
    await writeFile(file, Buffer.from(b64, 'base64'));
    made++;
    console.log(`(${i + 1}/${words.length}) ${word} — 저장 완료`);
  } catch (e) {
    console.error(`(${i + 1}/${words.length}) ${word} — 실패: ${e.message.slice(0, 120)}`);
  }
}
console.log(`끝! 새로 만든 그림 ${made}장`);
