// 서버(api/*)와 사전 생성 스크립트(scripts/*)가 함께 쓰는 도우미

export function safeWord(w) {
  return typeof w === 'string' && /^[가-힣]{1,8}$/.test(w);
}

export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

// APP_PASSCODE 환경변수가 설정돼 있으면 교사용 코드를 확인합니다.
export function checkAuth(req, res) {
  const code = process.env.APP_PASSCODE;
  if (!code) return true;
  if (req.headers['x-passcode'] === code) return true;
  res.status(401).json({ error: 'passcode' });
  return false;
}

export function imagePrompt(word) {
  return [
    '유아 그림책 삽화.',
    '따뜻한 동화 그림체, 부드러운 파스텔 색감, 둥글고 귀여운 형태, 포근한 수채 질감.',
    `주제: "${word}" 하나만 화면 중앙에 크게 그린다. 아이들이 한눈에 알아볼 수 있는 대표적인 모습.`,
    '배경은 단순한 연한 하늘색 또는 연한 크림색.',
    '글자, 숫자, 로고, 워터마크는 절대 넣지 않는다.',
  ].join(' ');
}

// base64 JPEG 문자열을 돌려줍니다.
export async function generateImage(word, apiKey) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      prompt: imagePrompt(word),
      size: '1024x1024',
      quality: 'low',
      output_format: 'jpeg',
      output_compression: 80,
      n: 1,
    }),
  });
  if (!r.ok) throw new Error(`image ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error('image: empty response');
  return b64;
}
