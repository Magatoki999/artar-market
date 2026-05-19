// api/purchase-check.js
// GET /api/purchase-check?artistId={id}&email={email}
// 購入済みかどうかを確認して記録を返す

import { createHash } from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { artistId, email } = req.query;
  if (!artistId || !email) return res.status(400).json({ error: 'artistId and email are required' });

  const emailHash = createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 16);
  const key = `purchase:${artistId}:${emailHash}`;

  try {
    const kvRes = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    });
    const kvData = await kvRes.json();

    if (!kvData.result) {
      return res.status(200).json({ purchased: false });
    }

    const record = JSON.parse(kvData.result);
    return res.status(200).json({ purchased: true, ...record });

  } catch (err) {
    console.error('[purchase-check] エラー:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
