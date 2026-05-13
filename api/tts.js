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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text = '', lang = 'ja', character = 'utsusemi' } = req.body;
  if (!text.trim()) return res.status(400).json({ error: 'text が空です' });

  // ElevenLabsキャラか判定
  const elevenVoiceId = ELEVENLABS_VOICES[character];

  if (elevenVoiceId) {
    return await speakElevenLabs(req, res, text, elevenVoiceId, character, lang);
  } else {
    return await speakGemini(req, res, text, character, lang);
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
          model_id: 'eleven_flash_v2_5',
          language_code: lang === 'ja' ? 'ja' : lang === 'zh' ? 'zh' : lang === 'ko' ? 'ko' : undefined,
          voice_settings: {
            stability: 0.5,
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
