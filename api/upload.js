// api/upload.js
// Cloudflare R2 Pre-signed URL発行
// GET /api/upload?filename=xxx.glb → { uploadUrl, publicUrl }
// ブラウザがそのまま uploadUrl に PUT すればR2に直接アップロードされる

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { filename } = req.query;
  if (!filename || !filename.toLowerCase().endsWith('.glb')) {
    return res.status(400).json({ error: '.glbファイル名を指定してください' });
  }

  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET) {
    return res.status(500).json({ error: 'R2環境変数が未設定です' });
  }

  try {
    const safeName = `glb/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const expires  = Math.floor(Date.now() / 1000) + 60 * 15; // 15分有効

    // AWS Signature V4 で Pre-signed URL を生成
    const url    = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${safeName}`);
    const host   = url.host;
    const region = 'auto';
    const service = 's3';

    const now        = new Date();
    const dateStr    = now.toISOString().slice(0, 10).replace(/-/g, '');
    const datetimeStr = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

    const credentialScope = `${dateStr}/${region}/${service}/aws4_request`;
    const credential      = `${R2_ACCESS_KEY_ID}/${credentialScope}`;

    const queryParams = new URLSearchParams({
      'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
      'X-Amz-Credential':    credential,
      'X-Amz-Date':          datetimeStr,
      'X-Amz-Expires':       '900',
      'X-Amz-SignedHeaders': 'host',
    });

    const canonicalRequest = [
      'PUT',
      `/${R2_BUCKET}/${safeName}`,
      queryParams.toString(),
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      datetimeStr,
      credentialScope,
      await sha256hex(canonicalRequest),
    ].join('\n');

    // HMAC-SHA256 署名
    const signingKey = await getSigningKey(R2_SECRET_ACCESS_KEY, dateStr, region, service);
    const signature  = await hmacHex(signingKey, stringToSign);

    const signedUrl = `${url.origin}/${R2_BUCKET}/${safeName}?${queryParams}&X-Amz-Signature=${signature}`;

    // パブリックURLはR2のpub-xxxドメイン経由
    const endpoint   = process.env.R2_ENDPOINT;
    const accountId  = endpoint.match(/([a-f0-9]+)\.r2\.cloudflarestorage\.com/)?.[1] || '';
    const publicUrl  = `https://pub-${accountId}.r2.dev/${safeName}`;

    return res.status(200).json({ uploadUrl: signedUrl, publicUrl });

  } catch (err) {
    console.error('[upload] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── 署名ヘルパー ────────────────────────────────────────────────────
async function sha256hex(message) {
  const data   = new TextEncoder().encode(message);
  const hash   = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function hmacHex(key, message) {
  const buf = await hmacSha256(key, message);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSigningKey(secret, date, region, service) {
  const kDate    = await hmacSha256(`AWS4${secret}`, date);
  const kRegion  = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}


