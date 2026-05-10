// api/artist.js
// アーティスト登録・取得 統合API
//
// POST /api/artist          → アーティスト登録（Redis保存 + URL返却）
// GET  /api/artist?id=xxxx  → アーティスト情報取得

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const BASE_URL    = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

// ── Upstash Redis ヘルパー ────────────────────────────────────────────
async function redisCommand(...args) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return res.json();
}

async function redisGet(key) {
  const data = await redisCommand('GET', key);
  if (!data.result) return null;
  return JSON.parse(data.result);
}

async function redisSet(key, value, exSeconds = null) {
  const args = ['SET', key, JSON.stringify(value)];
  if (exSeconds) args.push('EX', exSeconds);
  return redisCommand(...args);
}

// ── メインハンドラー ──────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: アーティスト情報取得 ────────────────────────────────────
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id パラメータが必要です' });

    try {
      const artist = await redisGet(`artist:${id}`);
      if (!artist) return res.status(404).json({ error: 'アーティストが見つかりません' });

      // メールアドレスはフロントに返さない
      const { email: _email, ...publicData } = artist;
      return res.status(200).json({ success: true, artist: publicData });

    } catch (err) {
      console.error('[artist GET] エラー:', err);
      return res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
  }

  // ── POST: アーティスト登録 ───────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const {
        name,
        bio,
        style      = '',
        artworkUrl = '',
        glbUrl     = '',
        genre      = '',
        priceMin   = '',
        priceMax   = '',
        twitter    = '',
        instagram  = '',
        email      = '',
        character  = 'utsusemi',
      } = req.body;

      if (!name || !bio) {
        return res.status(400).json({ error: '作家名と自己紹介は必須です' });
      }

      const id = Math.random().toString(36).slice(2, 10);

      const artistData = {
        id, name, bio, style, artworkUrl, glbUrl, genre,
        priceMin, priceMax, twitter, instagram, email, character,
        createdAt: new Date().toISOString(),
      };

      // 90日で期限切れ
      await redisSet(`artist:${id}`, artistData, 60 * 60 * 24 * 90);
      await redisCommand('LPUSH', 'artist_ids', id);

      const artistUrl = `${BASE_URL}/artist/${id}`;
      console.log(`[artist POST] 登録完了: ${name} (${id})`);

      return res.status(200).json({ success: true, id, url: artistUrl });

    } catch (err) {
      console.error('[artist POST] エラー:', err);
      return res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
