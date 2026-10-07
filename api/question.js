import { safeWord, readBody, checkAuth } from '../lib/common.js';

const CONSONANTS = ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

// 단계별로 따로 요청하면 한 번에 만드는 양이 줄어 훨씬 빨리 돌아옵니다.
// (화면에서는 3단계를 동시에 요청합니다)
const LEVELS = {
  1: {
    extra: {},
    rule: `[그림 보고 첫소리 듣기 — 가장 쉬움]
- count개. 그림만 보고 이름을 말할 수 있는 아주 친숙한 단어.`,
  },
  2: {
    extra: { riddle: { type: 'string' } },
    rule: `[수수께끼]
- count개. riddle은 한 문장, 40자 이내, "~은?" 또는 "~는?"으로 끝냅니다.
- 쉬운 의성어·의태어와 특징을 사용하고, 정답 단어 자체를 riddle에 넣지 않습니다.`,
  },
  3: {
    extra: { distractor: { type: 'string' }, distractorEmoji: { type: 'string' } },
    rule: `[둘 중 하나 고르기]
- count개. word가 정답이고, distractor는 반드시 pool 목록 안에서만 고릅니다(자음이 다른 단어).
- distractorEmoji는 distractor의 이모지입니다.`,
  },
};

const schemaFor = (extra) => ({
  name: 'chosori_items',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['word', 'emoji', ...Object.keys(extra)],
          properties: { word: { type: 'string' }, emoji: { type: 'string' }, ...extra },
        },
      },
    },
  },
});

const COMMON = `당신은 만 3~5세 유아의 한글 첫소리(초성) 놀이 문제를 만드는 유아교육 전문가입니다.
사용자가 JSON으로 준 자음(consonant)과 개수(count)에 맞춰 문제를 만드세요.
- word는 선택한 자음으로 첫 글자의 초성이 시작하는 한국어 일상 명사입니다. 예: ㄱ → 고양이.
- 첫 글자에 받침이 없는 단어(자음+모음으로 된 첫 글자, 예: 나비·고양이·바나나)를 우선합니다. 늑대·공룡·눈처럼 첫 글자에 받침이 있는 단어는 피합니다.
- 2~3음절 위주, 그림으로 쉽게 그릴 수 있는 구체적인 동물·사물·음식·탈것만 씁니다. 추상어·어려운 단어 금지.
- 조사 없는 기본형, 한글만 씁니다. emoji는 대표 이모지 1개.
- known은 그림이 이미 저장된 단어입니다. 약 2/3는 known에서, 나머지만 새 단어로 고르세요.
- exclude 단어는 쓰지 않고, 서로 겹치지 않게 합니다.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!checkAuth(req, res)) return;

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: 'no_key' });

  const body = readBody(req);
  const consonant = body.consonant;
  const level = LEVELS[body.level];
  if (!CONSONANTS.includes(consonant)) return res.status(400).json({ error: 'bad_consonant' });
  if (!level) return res.status(400).json({ error: 'bad_level' });

  const count = Math.min(5, Math.max(3, parseInt(body.count, 10) || 3));
  const list = (v) => (Array.isArray(v) ? v.filter(safeWord).slice(0, 60) : []);
  const payload = { consonant, count, known: list(body.known), exclude: list(body.exclude) };
  if (body.level === 3) payload.pool = list(body.pool);

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini',
        temperature: 0.8,
        max_tokens: 400,
        messages: [
          { role: 'system', content: `${COMMON}\n\n${level.rule}` },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_schema', json_schema: schemaFor(level.extra) },
      }),
    });
    if (!r.ok) throw new Error(`openai ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const data = JSON.parse(j.choices[0].message.content);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ items: data.items });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'question_failed' });
  }
}
