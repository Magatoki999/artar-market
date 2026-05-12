// api/admin.js
// 管理画面用API
// GET /api/admin?action=verify&password=xxx
// GET /api/admin?action=stats&password=xxx
// GET /api/admin?action=payments&password=xxx&limit=50
// GET /api/admin?action=artists&password=xxx

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisCommand(...args) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return res.json();
}

async function redisGet(key) {
  const data = await redisCommand('GET', key);
  if (!data.result) return null;
  return JSON.parse(data.result);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { action, password, limit = '50', starting_after } = req.query;

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD が未設定です' });
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: '認証に失敗しました' });

  if (action === 'verify') return res.status(200).json({ ok: true });

  try {
    // ── アーティスト一覧 ──────────────────────────────────────────
    if (action === 'artists') {
      const listData = await redisCommand('LRANGE', 'artist_ids', 0, 199);
      const ids = [...new Set(listData.result || [])];
      const artists = await Promise.all(
        ids.map(async (id) => {
          const a = await redisGet(`artist:${id}`);
          return a || null;
        })
      );
      return res.status(200).json({
        data: artists.filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      });
    }

    // ── Stripe ────────────────────────────────────────────────────
    if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY が未設定です' });
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // 売上一覧
    if (action === 'payments') {
      const params = { limit: Math.min(parseInt(limit) || 50, 100) };
      if (starting_after) params.starting_after = starting_after;
      const intents = await stripe.paymentIntents.list(params);
      const rows = intents.data.map(pi => ({
        id:          pi.id,
        status:      pi.status,
        amount:      pi.amount,
        created:     pi.created,
        email:       pi.receipt_email || pi.metadata?.email || '',
        artistId:    pi.metadata?.artistId   || '',
        artworkName: pi.metadata?.artworkName || '',
        artistName:  pi.metadata?.artistName  || '',
        txHash:      pi.metadata?.txHash      || '',
        wallet:      pi.metadata?.wallet      || '',
        nftMinted:   pi.metadata?.nftMinted === 'true',
      }));
      return res.status(200).json({
        data: rows,
        has_more: intents.has_more,
        last_id: rows.length > 0 ? rows[rows.length - 1].id : null,
      });
    }

    // 統計
    if (action === 'stats') {
      const intents = await stripe.paymentIntents.list({ limit: 100 });
      const succeeded = intents.data.filter(pi => pi.status === 'succeeded');
      const totalAmount = succeeded.reduce((s, pi) => s + pi.amount, 0);

      // 作品別集計
      const byArtwork = {};
      succeeded.forEach(pi => {
        const key = pi.metadata?.artworkName || '不明';
        if (!byArtwork[key]) byArtwork[key] = { count: 0, amount: 0 };
        byArtwork[key].count++;
        byArtwork[key].amount += pi.amount;
      });

      // 日別集計
      const daily = {};
      succeeded.forEach(pi => {
        const d = new Date(pi.created * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (!daily[key]) daily[key] = { count: 0, amount: 0 };
        daily[key].count++;
        daily[key].amount += pi.amount;
      });

      // Polygonウォレット残高
      let walletBalance = null;
      try {
        const rpcRes = await fetch(process.env.POLYGON_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc:'2.0', method:'eth_getBalance', params:[
            new (await import('ethers')).ethers.Wallet(process.env.PRIVATE_KEY).address, 'latest'
          ], id:1 }),
        });
        const rpcData = await rpcRes.json();
        const wei = BigInt(rpcData.result);
        walletBalance = (Number(wei) / 1e18).toFixed(4);
      } catch(e) { walletBalance = 'エラー'; }

      return res.status(200).json({
        totalAmount,
        totalCount:     succeeded.length,
        nftMintedCount: succeeded.filter(pi => pi.metadata?.nftMinted === 'true').length,
        byArtwork,
        daily,
        walletBalance,
      });
    }

    return res.status(400).json({ error: '不明なaction' });

  } catch (err) {
    console.error('[admin]', err);
    return res.status(500).json({ error: err.message });
  }
}
