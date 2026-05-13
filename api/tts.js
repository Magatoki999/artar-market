// api/tts.js
// Gemini TTS - @google/genai SDK方式
// POST /api/tts { text, lang, character }

import { GoogleGenAI } from '@google/genai';

const CHAR_VOICE = {
  utsusemi: { voice: 'Kore' },
  yugao:    { voice: 'Aoede' },
  ohma:     { voice: 'Charon' },
  aciel:    { voice: 'Puck' },
};

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

  const cfg = CHAR_VOICE[character] || CHAR_VOICE.utsusemi;

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: cfg.voice },
          },
        },
      },
    });

    const audioPart = response.candidates?.[0]?.content?.parts?.find(
      p => p.inlineData?.mimeType?.startsWith('audio/')
    );

    if (!audioPart?.inlineData?.data) {
      console.error('[tts] 音声データなし');
      return res.status(502).json({ error: '音声データが取得できませんでした' });
    }

    let finalB64  = audioPart.inlineData.data;
    let finalMime = audioPart.inlineData.mimeType;

    console.log(`[tts] mimeType=${finalMime} dataLen=${finalB64.length}`);

    // PCM/L16 は常にWAVヘッダーを付与（ブラウザで再生できるように）
    if (finalMime.includes('L16') || finalMime.includes('pcm') || finalMime.includes('raw')) {
      const pcmBuffer = Buffer.from(finalB64, 'base64');
      const wavBuffer = addWavHeader(pcmBuffer, 24000, 1, 16);
      finalB64  = wavBuffer.toString('base64');
      finalMime = 'audio/wav';
      console.log(`[tts] PCM→WAV変換完了 wavLen=${finalB64.length}`);
    }

    console.log(`[tts] 完了 char=${character} voice=${cfg.voice} lang=${lang}`);
    return res.status(200).json({ audioBase64: finalB64, mimeType: finalMime });

  } catch (err) {
    console.error('[tts] エラー:', err.message);
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
