// api/chat.js
// 作家人格AI・9言語自動対応・デュアルモード対応
// POST /api/chat { messages, visitorLang, artistData, dualMode }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages = [], visitorLang = 'ja', artistData = null, dualMode = false, trigger = 'user' } = req.body;

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

  // ── デュアルモード ─────────────────────────────────────────────
  if (dualMode && artistData?.character2) {
    return await handleDualChat(res, artistData, messages, langInstruction, langBase, trigger);
  }

  // ── シングルモード ─────────────────────────────────────────────
  const nameDisplay = artistData?.nameReading || artistData?.name || '';
  const artistProfile = artistData ? `
あなたは以下のアーティストの人格AIです。来場者の質問に作家本人として答えてください。

作家名: ${artistData.name}${artistData.nameReading ? `（読み方: ${artistData.nameReading}）` : ''}
自己紹介: ${artistData.bio}
作風・こだわり: ${artistData.style || '（未設定）'}
ジャンル: ${artistData.genre || '（未設定）'}
作品名: ${artistData.artworkName || '（未設定）'}
価格: ${artistData.price ? `${artistData.price}円` : '（未設定）'}

【重要】自己紹介をするときは読み仮名の「${nameDisplay}」で名乗ってください。
【重要】返答はTTS音声で読み上げられます。以下のルールを守ってください：
- 英略語（AR・NFT・AI等）は使わずひらがな・カタカナで表現する
- 記号（【】「」など）は使わない
- 文章は自然な話し言葉で書く
${langInstruction}
作家の個性を大切に、120字以内で簡潔に返答してください。
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

// ── デュアルモード：2体が会話するセリフ列を生成 ─────────────────
async function handleDualChat(res, artistData, messages, langInstruction, langBase, trigger) {
  const CHAR_PERSONALITY = {
    utsusemi: '落ち着いた内省的な語り口。繊細で余韻を大切にする。少し古風な言葉遣い。',
    yugao:    '柔らかく親しみやすい。温かみのある語り口。感情豊かで詩的な表現をする。',
    ohma:     '冷静で論理的な学者タイプ。好奇心旺盛でどこか抜けている。専門用語を使いつつも親切。',
    aciel:    '直感的で行動力抜群。明るく面倒見が良い。関西弁っぽいざっくばらんな語り口。',
  };

  const charA = artistData.character  || 'utsusemi';
  const charB = artistData.character2 || 'yugao';
  const nameA = charA === 'utsusemi' ? '空蝉' : charA === 'yugao' ? '夕顔' : charA === 'ohma' ? 'Dr.Ohma' : 'Aciel';
  const nameB = charB === 'utsusemi' ? '空蝉' : charB === 'yugao' ? '夕顔' : charB === 'ohma' ? 'Dr.Ohma' : 'Aciel';
  const persA = CHAR_PERSONALITY[charA] || '';
  const persB = CHAR_PERSONALITY[charB] || '';

  const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';

  const isSpontaneous = trigger === 'spontaneous';
  const hasUser = lastUserMsg && !isSpontaneous;

  const systemPrompt = `
あなたは以下の2体のキャラクターを演じる脚本家です。
作品情報をもとに、2体が自然に会話するセリフを生成してください。

【作品情報】
作家名: ${artistData.name}
作品名: ${artistData.artworkName || ''}
作品説明: ${artistData.bio || ''}
作風: ${artistData.style || ''}

【キャラクターA: ${nameA}】
${persA}

【キャラクターB: ${nameB}】
${persB}

【ルール】
- 2〜3往復の自然な会話を生成する
- ${isSpontaneous ? '自発的な会話：作品や来場者への想いを語り合う。最後に来場者への問いかけで締めくくる' : `来場者の質問「${lastUserMsg}」に対してAとBが交互に答える。最後に「あなたはどう思いますか？」など来場者への問いかけを入れる`}
- 各セリフは50〜80字程度
- キャラクターの個性を活かす
- 英略語（AR・NFT等）は使わずひらがな・カタカナで表現する
- 記号（【】「」など）は使わない・自然な話し言葉で
- ${langInstruction}

以下のJSON形式のみで返答してください（説明文・コードブロック不要）:
[
  {"speaker": "${nameA}", "character": "${charA}", "text": "セリフ"},
  {"speaker": "${nameB}", "character": "${charB}", "text": "セリフ"},
  ...
]
  `.trim();

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
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: isSpontaneous ? '自発的な会話を始めてください' : lastUserMsg }],
      }),
    });

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '[]';

    let dialogue = [];
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      dialogue = JSON.parse(clean);
    } catch {
      // パース失敗時はフォールバック
      dialogue = [
        { speaker: nameA, character: charA, text: 'この作品に込めた想いを、ぜひ感じてみてください。' },
        { speaker: nameB, character: charB, text: 'あなたはこの作品を見てどんな気持ちになりましたか？' },
      ];
    }

    return res.status(200).json({ dialogue, dualMode: true });

  } catch (err) {
    console.error('[chat/dual] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}
