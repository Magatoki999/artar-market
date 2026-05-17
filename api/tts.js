// api/tts.js
// TTS API - ElevenLabs（空蝉・夕顔・Aciel）+ Gemini TTS（Dr.Ohma）
// POST /api/tts { text, lang, character }

import { GoogleGenAI } from '@google/genai';

// ElevenLabs Voice ID
const ELEVENLABS_VOICES = {
  utsusemi: 'UpdXxdgP0QjvNsFGDFgb',
  yugao:    'Xv0eErzt5m8SIaLyDz96',
  aciel:    'zO6UmrwcDdqU3tqupELE',
};

// Gemini TTS（Dr.Ohma用）
const GEMINI_VOICE = {
  ohma: 'Charon',
};

// テキスト前処理（読み間違い対策）
function preprocessText(text, lang) {
  if (lang !== 'ja') return text;
  return text
    // 英略語→カタカナ
    .replace(/\bAR\b/g, 'エーアール')
    .replace(/\bNFT\b/g, 'エヌエフティー')
    .replace(/\bAI\b/g, 'エーアイ')
    .replace(/\bURL\b/g, 'ユーアールエル')
    .replace(/\bQR\b/g, 'キューアール')
    .replace(/\bVR\b/g, 'ブイアール')
    .replace(/\bSNS\b/g, 'エスエヌエス')
    .replace(/\bDr\./g, 'ドクター')
    // 数字→読みやすい形式
    .replace(/(\d+)円/g, '$1えん')
    .replace(/(\d+)個/g, '$1こ')
    .replace(/(\d+)点/g, '$1てん')
    // 読み仮名カッコを除去（例：山田花子（やまだはなこ）→ 山田花子）
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/…+/g, '。')
    .replace(/〜/g, 'から')
    .replace(/・/g, '、')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text = '', lang = 'ja', character = 'utsusemi' } = req.body;
  if (!text.trim()) return res.status(400).json({ error: 'text が空です' });

  const processedText = preprocessText(text, lang);

  // TTS_ENGINE 環境変数で切り替え（デフォルト: elevenlabs）
  // 'voicevox' に設定するとVOICEVOXを使用
  const engine = process.env.TTS_ENGINE || 'elevenlabs';

  if (engine === 'voicevox') {
    return await speakVoiceVox(req, res, processedText, character, lang);
  }

  const elevenVoiceId = ELEVENLABS_VOICES[character];
  if (elevenVoiceId) {
    return await speakElevenLabs(req, res, processedText, elevenVoiceId, character, lang);
  } else {
    return await speakGemini(req, res, processedText, character, lang);
  }
}

// ── ElevenLabs TTS ────────────────────────────────────────────────
async function speakElevenLabs(req, res, text, voiceId, character, lang) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY が未設定です' });

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          language_code: 'ja',
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('[tts/elevenlabs] エラー:', response.status, errText);
      return res.status(502).json({ error: `ElevenLabs エラー: ${response.status}` });
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioB64 = Buffer.from(arrayBuffer).toString('base64');

    console.log(`[tts/elevenlabs] 完了 char=${character} voiceId=${voiceId} lang=${lang}`);
    return res.status(200).json({ audioBase64: audioB64, mimeType: 'audio/mpeg' });

  } catch (err) {
    console.error('[tts/elevenlabs] エラー:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Gemini TTS（Dr.Ohma用） ───────────────────────────────────────
async function speakGemini(req, res, text, character, lang) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY が未設定です' });

  const voiceName = GEMINI_VOICE[character] || 'Charon';

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    });

    const audioPart = response.candidates?.[0]?.content?.parts?.find(
      p => p.inlineData?.mimeType?.startsWith('audio/')
    );

    if (!audioPart?.inlineData?.data) {
      return res.status(502).json({ error: '音声データが取得できませんでした' });
    }

    let finalB64  = audioPart.inlineData.data;
    let finalMime = audioPart.inlineData.mimeType;

    if (/l16|pcm|raw/i.test(finalMime)) {
      const rateMatch     = finalMime.match(/rate=(\d+)/i);
      const channelsMatch = finalMime.match(/channels=(\d+)/i);
      const sampleRate  = rateMatch     ? parseInt(rateMatch[1])     : 24000;
      const numChannels = channelsMatch ? parseInt(channelsMatch[1]) : 1;
      const pcmBuffer   = Buffer.from(finalB64, 'base64');
      const wavBuffer   = addWavHeader(pcmBuffer, sampleRate, numChannels, 16);
      finalB64  = wavBuffer.toString('base64');
      finalMime = 'audio/wav';
    }

    console.log(`[tts/gemini] 完了 char=${character} voice=${voiceName} lang=${lang}`);
    return res.status(200).json({ audioBase64: finalB64, mimeType: finalMime });

  } catch (err) {
    console.error('[tts/gemini] エラー:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── VOICEVOX TTS ─────────────────────────────────────────────────
// VOICEVOX_URL 環境変数にVOICEVOXサーバーのURLを設定
// キャラ別speaker ID（VOICEVOXデフォルト音声）
const VOICEVOX_SPEAKERS = {
  utsusemi: 2,   // 四国めたん（ノーマル）→後で変更可
  yugao:    0,   // 四国めたん（あまあま）
  ohma:     3,   // ずんだもん（ノーマル）
  aciel:    1,   // 四国めたん（ツンツン）
};

async function speakVoiceVox(req, res, text, character, lang) {
  const baseUrl = process.env.VOICEVOX_URL;
  if (!baseUrl) return res.status(500).json({ error: 'VOICEVOX_URL が未設定です' });

  const speakerId = VOICEVOX_SPEAKERS[character] ?? 0;

  try {
    // 1. audio_query生成
    const queryRes = await fetch(
      `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
      { method: 'POST' }
    );
    if (!queryRes.ok) throw new Error(`audio_query失敗: ${queryRes.status}`);
    const query = await queryRes.json();

    // 速度・ピッチ調整
    query.speedScale  = (character === 'utsusemi' || character === 'yugao') ? 0.9 : 1.1;
    query.pitchScale  = (character === 'utsusemi' || character === 'yugao') ? 0.05 : 0;
    query.intonationScale = 1.2;

    // 2. 音声合成
    const synthRes = await fetch(
      `${baseUrl}/synthesis?speaker=${speakerId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      }
    );
    if (!synthRes.ok) throw new Error(`synthesis失敗: ${synthRes.status}`);

    const arrayBuffer = await synthRes.arrayBuffer();
    const audioB64 = Buffer.from(arrayBuffer).toString('base64');

    console.log(`[tts/voicevox] 完了 char=${character} speaker=${speakerId}`);
    return res.status(200).json({ audioBase64: audioB64, mimeType: 'audio/wav' });

  } catch (err) {
    console.error('[tts/voicevox] エラー:', err.message);
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
