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
    const { id, list } = req.query;

    // 一覧取得モード
    if (list === 'true') {
      try {
        const listData = await redisCommand('LRANGE', 'artist_ids', 0, 99);
        const ids = listData.result || [];

        // 重複除去
        const uniqueIds = [...new Set(ids)];

        // 各アーティスト情報を取得
        const artists = await Promise.all(
          uniqueIds.map(async (aid) => {
            const a = await redisGet(`artist:${aid}`);
            if (!a) return null;
            const { email: _email, ...pub } = a;
            return pub;
          })
        );

        // nullを除外して新しい順に返す
        const result = artists
          .filter(Boolean)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return res.status(200).json({ success: true, artists: result });
      } catch (err) {
        console.error('[artist LIST] エラー:', err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました' });
      }
    }

    // 個別取得モード
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
        nameReading    = '',
        bio,
        style          = '',
        sampleLines    = [],
        artworkUrl     = '',
        glbUrl         = '',
        glbUrl2        = '',
        nftImageUrl    = '',
        artworkName    = '',
        artworkStory   = '',
        artworkMessage = '',
        faqs           = [],
        price          = 0,
        genre          = '',
        twitter        = '',
        instagram      = '',
        email          = '',
        character      = 'utsusemi',
        character2     = '',
        dualMode       = false,
      } = req.body;

      if (!name || !bio) {
        return res.status(400).json({ error: '作家名と自己紹介は必須です' });
      }
      if (!artworkName) {
        return res.status(400).json({ error: '作品名は必須です' });
      }
      if (!price || Number(price) < 100) {
        return res.status(400).json({ error: '価格は100円以上で入力してください' });
      }

      const id = Math.random().toString(36).slice(2, 10);

      const artistData = {
        id, name, nameReading, bio, style, sampleLines,
        artworkUrl, glbUrl, glbUrl2, nftImageUrl,
        artworkName, artworkStory, artworkMessage, faqs,
        price: Number(price), genre,
        twitter, instagram, email,
        character, character2, dualMode: Boolean(dualMode),
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
