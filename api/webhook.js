// api/webhook.js
// Stripe Webhook → NFT mint → 購入者・アーティストへメール通知
// POST /api/webhook

import { ethers } from 'ethers';
import { Resend } from 'resend';

const NFT_ABI = [
  'function mintNFT(address recipient, string memory tokenURI) public returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

// キャラクター別デフォルトNFT画像
const CHAR_DEFAULT_NFT = {
  utsusemi: 'https://pub-5162ceda92fb4bf7aca56c2066725d33.r2.dev/nft/utsusemi_default.png',
  yugao:    'https://pub-5162ceda92fb4bf7aca56c2066725d33.r2.dev/nft/yugao_default.png',
  ohma:     'https://pub-5162ceda92fb4bf7aca56c2066725d33.r2.dev/nft/ohma_default.png', // 登録後に追加
  aciel:    'https://pub-5162ceda92fb4bf7aca56c2066725d33.r2.dev/nft/aciel_default.png', // 登録後に追加
};

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

// ── Privy: メール → ウォレット取得 or 生成 ──────────────────────────
async function getOrCreateWallet(email) {
  const authHeader = `Basic ${Buffer.from(
    `${process.env.PRIVY_APP_ID}:${process.env.PRIVY_SECRET_KEY}`
  ).toString('base64')}`;
  const headers = {
    'Content-Type': 'application/json',
    'privy-app-id': process.env.PRIVY_APP_ID,
    'Authorization': authHeader,
  };

  const createRes = await fetch('https://auth.privy.io/api/v1/users', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      linked_accounts: [{ type: 'email', address: email }],
      create_ethereum_wallet: true,
    }),
  });

  let userData;
  if (createRes.status === 200 || createRes.status === 201) {
    userData = await createRes.json();
  } else if (createRes.status === 409) {
    const searchRes = await fetch(
      `https://auth.privy.io/api/v1/users?email=${encodeURIComponent(email)}`,
      { method: 'GET', headers }
    );
    const searchData = await searchRes.json();
    const users = searchData.data || searchData;
    userData = Array.isArray(users) ? users[0] : users;
  } else {
    throw new Error(`Privy API エラー: ${createRes.status}`);
  }

  const wallet = (userData?.linked_accounts || []).find(
    a => a.type === 'wallet' && a.chain_type === 'ethereum'
  );
  if (!wallet?.address) throw new Error('ウォレットアドレスが見つかりません');
  return wallet.address;
}

// ── NFT mint ────────────────────────────────────────────────────────
async function mintNFT(recipientAddress, metadata) {
  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
  const signer   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(process.env.POLYGON_CONTRACT_ADDRESS, NFT_ABI, signer);

  // メタデータをBase64 JSONで埋め込む
  const metaJson = JSON.stringify({
    name:        metadata.name,
    description: metadata.description,
    image:       metadata.artworkUrl || '',
    attributes: [
      { trait_type: 'Artist',       value: metadata.artistName },
      { trait_type: 'Artwork',      value: metadata.artworkName },
      { trait_type: 'Amount (JPY)', value: Number(metadata.amount) },
      { trait_type: 'Platform',     value: 'ArtAR' },
      { trait_type: 'Certificate',  value: metadata.certId },
    ],
  });
  const tokenURI = `data:application/json;base64,${Buffer.from(metaJson).toString('base64')}`;

  const tx      = await contract.mintNFT(recipientAddress, tokenURI);
  const receipt = await tx.wait();
  return receipt.hash;
}

// ── 購入者へメール ───────────────────────────────────────────────────
async function sendBuyerEmail({ email, artistName, artworkName, amount, certId, txHash, nftImageUrl }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const nftImageHtml = nftImageUrl
    ? `<div style="text-align:center;margin:20px 0;"><img src="${nftImageUrl}" alt="NFT" style="max-width:280px;width:100%;border:2px solid rgba(212,175,55,0.5);border-radius:12px;"></div>`
    : '';
  const polygonUrl = `https://polygonscan.com/tx/${txHash}`;

  await resend.emails.send({
    from:    process.env.RESEND_FROM || 'noreply@magatokilab.com',
    to:      email,
    subject: `【ArtAR】${artworkName} の購入証明NFTが届きました`,
    html: `
<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"></head>
<body style="background:#0d0a04;color:#e8e0d0;font-family:'Yu Mincho',serif;padding:32px 16px;margin:0;">
  <div style="max-width:480px;margin:0 auto;">
    <p style="font-size:22px;color:#c8a96e;letter-spacing:4px;margin-bottom:4px;">ArtAR</p>
    <p style="font-size:12px;color:rgba(255,255,255,0.4);letter-spacing:2px;margin-bottom:24px;">Purchase Certificate NFT</p>
    ${nftImageHtml}
    <p style="font-size:14px;line-height:2;color:rgba(255,255,255,0.75);">
      このたびはご購入いただき、誠にありがとうございます。<br>
      購入証明NFTをブロックチェーンに記録しました。
    </p>
    <div style="margin:24px 0;background:rgba(255,255,255,0.04);border:1px solid rgba(200,169,110,0.3);border-radius:12px;padding:20px;">
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <tr><td style="color:rgba(255,255,255,0.4);padding:6px 0;width:40%;">作品名</td><td style="color:#fff;">${artworkName}</td></tr>
        <tr><td style="color:rgba(255,255,255,0.4);padding:6px 0;">アーティスト</td><td style="color:#fff;">${artistName}</td></tr>
        <tr><td style="color:rgba(255,255,255,0.4);padding:6px 0;">お支払い金額</td><td style="color:#fff;">¥${Number(amount).toLocaleString()}</td></tr>
        <tr><td style="color:rgba(255,255,255,0.4);padding:6px 0;">証明ID</td><td style="color:#c8a96e;font-family:monospace;font-size:11px;">${certId}</td></tr>
      </table>
    </div>
    <a href="${polygonUrl}" style="display:block;text-align:center;padding:14px;background:linear-gradient(135deg,#b8962e,#D4AF37);color:#1a1208;font-weight:bold;font-size:14px;letter-spacing:2px;border-radius:10px;text-decoration:none;margin-bottom:24px;">ブロックチェーンで確認する →</a>
    <p style="font-size:11px;color:rgba(255,255,255,0.2);margin-top:24px;">MAGATOKI Laboratory / ArtAR</p>
  </div>
</body></html>`.trim(),
  });
}

// ── メインハンドラ ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  let event;
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const sig    = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] 署名検証失敗:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type !== 'payment_intent.succeeded') {
    return res.status(200).json({ received: true });
  }

  const paymentIntent = event.data.object;
  const metadata      = paymentIntent.metadata || {};
  const email         = paymentIntent.receipt_email || metadata.email;

  console.log(`[webhook] 決済完了: ${paymentIntent.id} artist:${metadata.artistId}`);

  const certId = `ARTAR-${Date.now().toString(36).toUpperCase().slice(-6)}`;

  try {
    // Redis からアーティスト情報を取得
    const artistRes = await fetch(
      `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/artist?id=${metadata.artistId}`
    );
    const artistData = artistRes.ok ? (await artistRes.json()).artist : {};

    // Privy でウォレット取得・生成
    const walletAddress = await getOrCreateWallet(email);
    console.log('[webhook] wallet:', walletAddress);

    // NFT画像の優先順位: クリエーター登録画像 → キャラデフォルト → 作品画像
    const charDefault = CHAR_DEFAULT_NFT[artistData.character] || null;
    const nftImageUrl = artistData.nftImageUrl || charDefault || artistData.artworkUrl || '';

    // NFT mint
    const txHash = await mintNFT(walletAddress, {
      name:        `ArtAR Purchase — ${metadata.artworkName}`,
      description: `${metadata.artistName} の作品「${metadata.artworkName}」購入証明NFT`,
      artworkUrl:  nftImageUrl,
      artistName:  metadata.artistName  || artistData.name || '',
      artworkName: metadata.artworkName || '',
      amount:      metadata.amount,
      certId,
    });
    console.log('[webhook] NFT mint完了:', txHash);

    // 購入者へメール
    await sendBuyerEmail({
      email,
      artistName:  metadata.artistName  || artistData.name || '',
      artworkName: metadata.artworkName || '',
      amount:      metadata.amount,
      certId,
      txHash,
      nftImageUrl,
    });
    console.log('[webhook] メール送信完了:', email);

    return res.status(200).json({ success: true, txHash, certId });

  } catch (err) {
    console.error('[webhook] エラー:', err);
    // Stripeには200を返してリトライを防ぐ
    return res.status(200).json({ received: true, error: err.message });
  }
}
