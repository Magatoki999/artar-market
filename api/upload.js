// api/upload.js
// GLBファイルをVercel Blobにアップロードする
// POST /api/upload  (multipart/form-data, field: "glb")

import { put } from '@vercel/blob';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN が未設定です' });
  }

  try {
    // multipart を手動パース
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '';

    // boundary を取得
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) return res.status(400).json({ error: 'multipart boundary が見つかりません' });
    const boundary = boundaryMatch[1];

    // パーツを分割
    const parts = buffer.toString('binary').split('--' + boundary);
    let glbBuffer = null;
    let filename   = 'model.glb';

    for (const part of parts) {
      if (!part.includes('Content-Disposition')) continue;
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const header = part.substring(0, headerEnd);
      if (!header.includes('name="glb"')) continue;

      // ファイル名取得
      const fnMatch = header.match(/filename="([^"]+)"/);
      if (fnMatch) filename = fnMatch[1];

      // バイナリデータ取得
      const bodyStart = headerEnd + 4;
      const bodyEnd   = part.lastIndexOf('\r\n');
      const binaryStr = part.substring(bodyStart, bodyEnd > bodyStart ? bodyEnd : undefined);
      glbBuffer = Buffer.from(binaryStr, 'binary');
      break;
    }

    if (!glbBuffer || glbBuffer.length === 0) {
      return res.status(400).json({ error: 'GLBファイルが見つかりません' });
    }

    // 拡張子チェック
    if (!filename.toLowerCase().endsWith('.glb')) {
      return res.status(400).json({ error: '.glbファイルのみアップロードできます' });
    }

    // サイズチェック（50MB上限）
    if (glbBuffer.length > 50 * 1024 * 1024) {
      return res.status(400).json({ error: 'ファイルサイズは50MB以内にしてください' });
    }

    // Vercel Blobにアップロード
    const safeName = `glb/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const blob = await put(safeName, glbBuffer, {
      access: 'public',
      contentType: 'model/gltf-binary',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    console.log(`[upload] GLBアップロード完了: ${blob.url} (${glbBuffer.length} bytes)`);
    return res.status(200).json({ success: true, url: blob.url });

  } catch (err) {
    console.error('[upload] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}
