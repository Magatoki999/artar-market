// api/upload.js
// GLBファイルをVercel Blobにアップロードする
// POST /api/upload  (multipart/form-data, field: "glb")

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
    const { put } = await import('@vercel/blob');

    // multipart をバイナリのままパース
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '';

    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: 'multipart boundary が見つかりません' });
    }
    const boundary = boundaryMatch[1];
    const boundaryBuf = Buffer.from('--' + boundary);

    let glbData = null;
    let filename = 'model.glb';
    let start = 0;

    while (start < buffer.length) {
      const boundaryIdx = buffer.indexOf(boundaryBuf, start);
      if (boundaryIdx === -1) break;
      const headerStart = boundaryIdx + boundaryBuf.length + 2;
      const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
      if (headerEnd === -1) break;

      const header = buffer.slice(headerStart, headerEnd).toString();
      const bodyStart = headerEnd + 4;
      const nextBoundary = buffer.indexOf(boundaryBuf, bodyStart);
      const bodyEnd = nextBoundary !== -1 ? nextBoundary - 2 : buffer.length;

      if (header.includes('name="glb"')) {
        const fnMatch = header.match(/filename="([^"]+)"/);
        if (fnMatch) filename = fnMatch[1];
        glbData = buffer.slice(bodyStart, bodyEnd);
        break;
      }
      start = nextBoundary !== -1 ? nextBoundary : buffer.length;
    }

    if (!glbData || glbData.length === 0) {
      return res.status(400).json({ error: 'GLBファイルが見つかりません' });
    }
    if (!filename.toLowerCase().endsWith('.glb')) {
      return res.status(400).json({ error: '.glbファイルのみアップロードできます' });
    }
    if (glbData.length > 50 * 1024 * 1024) {
      return res.status(400).json({ error: 'ファイルサイズは50MB以内にしてください' });
    }

    const safeName = `glb/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const blob = await put(safeName, glbData, {
      access: 'public',
      contentType: 'model/gltf-binary',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    console.log(`[upload] 完了: ${blob.url} (${glbData.length} bytes)`);
    return res.status(200).json({ success: true, url: blob.url });

  } catch (err) {
    console.error('[upload] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}
