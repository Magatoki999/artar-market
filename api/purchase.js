// api/purchase.js
// Stripe PaymentIntent を作成して client_secret を返す
// POST /api/purchase { artistId, amount, email, artworkName, artistName }

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

    const paymentIntent = await stripe.paymentIntents.create({
      amount:        Math.round(amount),
      currency:      'jpy',
      receipt_email: email,
      metadata: {
        artistId,
        amount:      String(amount),
        email,
        artworkName: artworkName || '',
        artistName:  artistName  || '',
      },
    });

    console.log('[purchase] PaymentIntent作成: ' + paymentIntent.id);
    return res.status(200).json({
      clientSecret:    paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });

  } catch (err) {
    console.error('[purchase] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}
