import { safeWord, readBody, checkAuth, generateImage } from '../lib/common.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!checkAuth(req, res)) return;

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: 'no_key' });

  const { word } = readBody(req);
  if (!safeWord(word)) return res.status(400).json({ error: 'bad_word' });

  try {
    const b64 = await generateImage(word, key);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ image: `data:image/jpeg;base64,${b64}` });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'image_failed' });
  }
}
