// api/purchase.js
// Stripe Checkout Session を作成して返す
// POST /api/purchase { artistId, amount, email, artworkName }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { artistId, amount, email, artworkName, artistName } = req.body;

  if (!artistId || !amount || !email) {
    return res.status(400).json({ error: 'artistId・amount・email は必須です' });
  }
  if (amount < 100) {
    return res.status(400).json({ error: '最低金額は100円です' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'メールアドレスが不正です' });
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const proto  = req.headers['x-forwarded-proto'] || 'https';
    const host   = req.headers['x-forwarded-host']  || req.headers.host;
    const base   = `${proto}://${host}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: {
            name: artworkName || '作品購入',
            description: `${artistName || 'アーティスト'} の作品`,
          },
          unit_amount: Math.round(amount),
        },
        quantity: 1,
      }],
      metadata: {
        artistId,
        amount:      String(amount),
        email,
        artworkName: artworkName || '',
        artistName:  artistName  || '',
      },
      success_url: `${base}/artist/${artistId}?purchased=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${base}/artist/${artistId}?cancelled=true`,
    });

    console.log(`[purchase] Checkout作成: ${session.id} artist:${artistId} amount:${amount}`);
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('[purchase] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}
