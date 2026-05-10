// api/upload.js
// Vercel Blob Client Upload 用トークン発行
// GET /api/upload?filename=xxx.glb → { token, url } でブラウザが直接BlobにPUT

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST = handleUpload コールバック（Vercel Blobからの完了通知）
  if (req.method === 'POST') {
    try {
      const { handleUpload } = await import('@vercel/blob/client');
      const body = req.body;
      const jsonResponse = await handleUpload({
        body,
        request: {
          headers: { get: (k) => req.headers[k.toLowerCase()] ?? null },
          url: `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/upload`,
        },
        onBeforeGenerateToken: async (pathname) => ({
          allowedContentTypes: ['model/gltf-binary', 'application/octet-stream'],
          maximumSizeInBytes: 50 * 1024 * 1024,
          addRandomSuffix: false,
        }),
        onUploadCompleted: async ({ blob }) => {
          console.log('[upload] 完了:', blob.url);
        },
      });
      return res.status(200).json(jsonResponse);
    } catch (err) {
      console.error('[upload POST] エラー:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  // GET = クライアントトークンを発行してブラウザに返す
  if (req.method === 'GET') {
    const { filename } = req.query;
    if (!filename || !filename.toLowerCase().endsWith('.glb')) {
      return res.status(400).json({ error: '.glbファイル名を指定してください' });
    }

    try {
      const { generateClientTokenFromReadWriteToken } = await import('@vercel/blob/client');
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const safeName = `glb/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const clientToken = await generateClientTokenFromReadWriteToken({
        token: process.env.BLOB_READ_WRITE_TOKEN,
        pathname: safeName,
        onUploadCompleted: {
          callbackUrl: `https://${host}/api/upload`,
        },
        maximumSizeInBytes: 50 * 1024 * 1024,
        allowedContentTypes: ['model/gltf-binary', 'application/octet-stream'],
      });

      return res.status(200).json({ clientToken, pathname: safeName });
    } catch (err) {
      console.error('[upload GET] エラー:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

