// api/upload.js
// Vercel Blob Client Upload 用トークン発行
// GET /api/upload?filename=xxx.glb → { clientToken, pathname, uploadUrl }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST = Vercel Blobからの完了コールバック（無視してOK返す）
  if (req.method === 'POST') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { filename } = req.query;
  if (!filename || !filename.toLowerCase().endsWith('.glb')) {
    return res.status(400).json({ error: '.glbファイル名を指定してください' });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN が未設定です' });
  }

  try {
    const safeName = `glb/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const host = req.headers['x-forwarded-host'] || req.headers.host;

    // Vercel Blob API でクライアントトークンを発行
    const apiRes = await fetch('https://blob.vercel-storage.com/upload/client-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-api-version': '7',
      },
      body: JSON.stringify({
        pathname: safeName,
        callbackUrl: `https://${host}/api/upload`,
        multipart: false,
        maximumSizeInBytes: 50 * 1024 * 1024,
        allowedContentTypes: ['model/gltf-binary', 'application/octet-stream'],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('[upload] Blob API エラー:', apiRes.status, errText);
      return res.status(500).json({ error: `Blob API エラー: ${apiRes.status} ${errText}` });
    }

    const data = await apiRes.json();
    console.log('[upload] トークン発行成功:', safeName);
    return res.status(200).json({
      clientToken: data.clientToken || data.token,
      pathname: safeName,
      uploadUrl: data.url || `https://blob.vercel-storage.com/${safeName}`,
    });

  } catch (err) {
    console.error('[upload] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}

