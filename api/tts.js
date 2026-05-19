// api/tts.js
// TTS API - ElevenLabs（空蝉・夕顔・Aciel）+ Gemini TTS（Dr.Ohma）
// POST /api/tts { text, lang, character, artistName?, artistNameReading? }

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

// ── テキスト前処理（読み間違い対策）────────────────────────────────
function preprocessText(text, lang, opts = {}) {
  if (lang && !lang.startsWith('ja')) return text;

  let t = text;

  // ① 読み仮名カッコを「展開」する（除去ではなく読み仮名側を採用）
  // chat.jsが「山田花子（やまだはなこ）」と返してくるのを「やまだはなこ」に変換
  // ※ カッコ内がひらがな/カタカナのみの場合だけ展開（英語説明などは除去）
  t = t.replace(/([^\s（(]{1,20})（([ぁ-んァ-ヶー]{1,20})）/g, '$2');
  t = t.replace(/([^\s（(]{1,20})\(([ぁ-んァ-ヶー]{1,20})\)/g, '$2');
  // 上記に当てはまらないカッコ（説明文など）は除去
  t = t.replace(/（[^）]{1,40}）/g, '');
  t = t.replace(/\([^)]{1,40}\)/g, '');

  // ② アーティスト名の動的読み仮名置換（最優先）
  // artistName と artistNameReading が渡されていれば置換
  if (opts.artistName && opts.artistNameReading) {
    const escaped = opts.artistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(escaped, 'g'), opts.artistNameReading);
  }

  // ③ 記号・装飾文字を除去（TTSが詰まる原因になる）
  t = t
    .replace(/[★☆◆◇◎●○■□▲△▼▽♦♠♣♥♡❤🌸✦✧※→←↑↓]/g, '')
    .replace(/[「」『』【】〈〉《》〔〕]/g, '')
    .replace(/[…‥]+/g, '。')
    .replace(/[ー]{2,}/g, 'ー')
    .replace(/[！!]{2,}/g, '！')
    .replace(/[？?]{2,}/g, '？')
    .replace(/〜+/g, 'から')
    .replace(/・{2,}/g, '。')
    .replace(/・/g, '、');

  // ④ 価格・数字の正規化
  t = t
    .replace(/¥\s*([0-9,]+)/g, (_, n) => n.replace(/,/g, '') + 'えん')
    .replace(/([0-9]{1,3}),([0-9]{3})/g, '$1$2')   // カンマ区切り数字を結合
    .replace(/(\d+)%/g, '$1パーセント')
    .replace(/(\d+)円/g, '$1えん')
    .replace(/(\d+)個/g, '$1こ')
    .replace(/(\d+)点/g, '$1てん')
    .replace(/(\d+)枚/g, '$1まい')
    .replace(/(\d+)本/g, '$1ほん')
    .replace(/(\d+)作/g, '$1さく')
    .replace(/(\d+)\s*\/\s*(\d+)/g, '$1分の$2');

  // ⑤ 英略語・固有名詞 → カタカナ（長いものを先に）
  const abbrevMap = [
    [/\bArtAR\b/g,     'アートエーアール'],
    [/\bVOICEVOX\b/g,  'ボイスボックス'],
    [/\bAR\b/g,        'エーアール'],
    [/\bNFT\b/g,       'エヌエフティー'],
    [/\bAI\b/g,        'エーアイ'],
    [/\bURL\b/g,       'ユーアールエル'],
    [/\bQR\b/g,        'キューアール'],
    [/\bVR\b/g,        'ブイアール'],
    [/\bXR\b/g,        'エックスアール'],
    [/\bSNS\b/g,       'エスエヌエス'],
    [/\bDr\.\s*/g,     'ドクター'],
    [/\bETH\b/g,       'イーサリアム'],
    [/\bPOL\b/g,       'ポル'],
    [/\bPC\b/g,        'パソコン'],
    [/\bID\b/g,        'アイディー'],
    [/\biOS\b/g,       'アイオーエス'],
    [/\bWeb\b/gi,      'ウェブ'],
    [/\bApp\b/g,       'アプリ'],
    [/\bGLB\b/g,       'ジーエルビー'],
    [/\bJPY\b/g,       'えん'],
    [/\bJP\b/g,        'ジェーピー'],
    [/\bOK\b/gi,       'オーケー'],
    [/\bNG\b/g,        'エヌジー'],
  ];
  for (const [pattern, replacement] of abbrevMap) {
    t = t.replace(pattern, replacement);
  }

  // ⑥ 残った連続アルファベット大文字（3文字以上）→ 1文字ずつスペース区切りで読ませる
  t = t.replace(/\b([A-Z]{3,})\b/g, (m) => m.split('').join(' '));

  // ⑦ 空白・改行の正規化
  t = t
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, '、')
    .trim();

  return t;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    text = '',
    lang = 'ja',
    character = 'utsusemi',
    artistName = '',
    artistNameReading = '',
  } = req.body;

  if (!text.trim()) return res.status(400).json({ error: 'text が空です' });

  const processedText = preprocessText(text, lang, { artistName, artistNameReading });

  if (processedText !== text) {
    console.log('[tts] preprocess:', JSON.stringify(text.slice(0, 60)), '→', JSON.stringify(processedText.slice(0, 60)));
  }

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
const VOICEVOX_SPEAKERS = {
  utsusemi: 2,
  yugao:    0,
  ohma:     3,
  aciel:    1,
};

async function speakVoiceVox(req, res, text, character, lang) {
  const baseUrl = process.env.VOICEVOX_URL;
  if (!baseUrl) return res.status(500).json({ error: 'VOICEVOX_URL が未設定です' });

  const speakerId = VOICEVOX_SPEAKERS[character] ?? 0;

  try {
    const queryRes = await fetch(
      `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
      { method: 'POST' }
    );
    if (!queryRes.ok) throw new Error(`audio_query失敗: ${queryRes.status}`);
    const query = await queryRes.json();

    query.speedScale      = (character === 'utsusemi' || character === 'yugao') ? 0.9 : 1.1;
    query.pitchScale      = (character === 'utsusemi' || character === 'yugao') ? 0.05 : 0;
    query.intonationScale = 1.2;

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
