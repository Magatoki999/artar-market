// api/upload.js
// Vercel Blob Client Upload 用トークン発行
// POST /api/upload  { filename: "model.glb" } → { clientToken, uploadUrl }

import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // .glb のみ許可
        if (!pathname.toLowerCase().endsWith('.glb')) {
          throw new Error('.glbファイルのみアップロードできます');
        }
        return {
          allowedContentTypes: ['model/gltf-binary', 'application/octet-stream'],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50MB
          tokenPayload: JSON.stringify({ pathname }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('[upload] 完了:', blob.url);
      },
    });
    return res.status(200).json(body);
  } catch (err) {
    console.error('[upload] エラー:', err);
    return res.status(400).json({ error: err.message });
  }
}

