// api/chat.js
// 作家人格AI・9言語自動対応
// POST /api/chat

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages = [], visitorLang = 'ja', artistData = null } = req.body;

  const LANG_INSTRUCTION = {
    ja: '日本語で返答してください。',
    en: 'Please respond in English.',
    zh: '请用中文回答。',
    ko: '한국어로 답변해 주세요.',
    fr: 'Veuillez répondre en français.',
    de: 'Bitte antworten Sie auf Deutsch.',
    es: 'Por favor responde en español.',
    it: 'Per favore rispondi in italiano.',
    th: 'กรุณาตอบเป็นภาษาไทย',
  };
  const langBase = (visitorLang || 'ja').toLowerCase().split('-')[0];
  const langInstruction = LANG_INSTRUCTION[langBase] || LANG_INSTRUCTION.ja;

  const artistProfile = artistData ? `
あなたは以下のアーティストの人格AIです。来場者の質問に作家本人として答えてください。

作家名: ${artistData.name}
自己紹介: ${artistData.bio}
作風・こだわり: ${artistData.style || '（未設定）'}
ジャンル: ${artistData.genre || '（未設定）'}
価格帯: ${artistData.priceMin || '?'}円〜${artistData.priceMax || '?'}円

${langInstruction}
作家の個性を大切に、150字以内で簡潔に返答してください。
  `.trim() : `あなたはアーティストの人格AIです。${langInstruction}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: artistProfile,
        messages: messages.slice(-10),
      }),
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'うまく答えられませんでした。';
    return res.status(200).json({ reply });

  } catch (err) {
    console.error('[chat] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}
