// api/tts.js
// Gemini TTS API でテキストを音声に変換
// POST /api/tts { text, lang, character }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY が未設定です' });

  const { text = '', lang = 'ja', character = 'utsusemi' } = req.body;
  if (!text.trim()) return res.status(400).json({ error: 'text が空です' });

  // キャラクター別音声設定
  const CHAR_VOICE = {
    utsusemi: {
      voice: 'Kore',
      prompt_ja: '穏やかで雅な平安時代の女性の口調で、ゆっくりと詩的に語りかけるように話してください。声は柔らかく、少し儚げで神秘的な雰囲気で。スピードは遅め、トーンは温かく詩的に。',
      prompt_en: 'Speak in a soft, gentle, classical Japanese feminine tone with a slight ethereal quality. Slow and graceful, like a noblewoman from ancient Japan.',
    },
    yugao: {
      voice: 'Aoede',
      prompt_ja: 'はかなく優美な平安女性の声で、静かに、少し切なげに、詩を読むように話してください。声は細く繊細で、夜の花のように儚い雰囲気で。',
      prompt_en: 'Speak in a delicate, melancholic tone like a gentle noblewoman. Soft, poetic, slightly wistful.',
    },
    ohma: {
      voice: 'Charon',
      prompt_ja: '落ち着いた知性的な男性の声で、科学者らしく丁寧かつ情熱的に話してください。スピードはやや速め、トーンは低く自信に満ちている。',
      prompt_en: 'Speak in a calm, intellectual male tone, like a passionate scientist. Slightly faster pace, deep and confident.',
    },
    aciel: {
      voice: 'Puck',
      prompt_ja: '明るく軽やかな声で、少し不思議な雰囲気を持ちながら親しみやすく話してください。エネルギッシュで好奇心旺盛な感じで。',
      prompt_en: 'Speak in a bright, playful tone with a slightly mysterious quality. Energetic and curious.',
    },
  };

  const cfg = CHAR_VOICE[character] || CHAR_VOICE.utsusemi;
  const voicePrompt = lang === 'en' ? cfg.prompt_en : cfg.prompt_ja;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${voicePrompt}\n\n${text}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } },
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('[tts] Gemini API エラー:', response.status, errText);
      return res.status(502).json({ error: `Gemini TTS エラー: ${response.status}` });
    }

    const data = await response.json();
    const audioPart = data?.candidates?.[0]?.content?.parts?.find(
      p => p.inlineData?.mimeType?.startsWith('audio/')
    );
    if (!audioPart?.inlineData?.data) {
      console.error('[tts] 音声データなし:', JSON.stringify(data).slice(0, 200));
      return res.status(502).json({ error: '音声データが取得できませんでした' });
    }

    let finalB64  = audioPart.inlineData.data;
    let finalMime = audioPart.inlineData.mimeType;

    if (finalMime.includes('L16') || finalMime.includes('pcm')) {
      const pcmBuffer = Buffer.from(finalB64, 'base64');
      const wavBuffer = addWavHeader(pcmBuffer, 24000, 1, 16);
      finalB64  = wavBuffer.toString('base64');
      finalMime = 'audio/wav';
    }

    console.log(`[tts] 完了 char=${character} voice=${cfg.voice} mime=${finalMime} lang=${lang}`);
    return res.status(200).json({ audioBase64: finalB64, mimeType: finalMime });

  } catch (err) {
    console.error('[tts] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}

function addWavHeader(pcmData, sampleRate, numChannels, bitDepth) {
  const dataSize   = pcmData.length;
  const header     = Buffer.alloc(44);
  const byteRate   = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign = numChannels * (bitDepth / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1,  20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate,  24);
  header.writeUInt32LE(byteRate,    28);
  header.writeUInt16LE(blockAlign,  32);
  header.writeUInt16LE(bitDepth,    34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmData]);
}
