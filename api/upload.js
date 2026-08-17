const crypto = require('crypto');
const { put } = require('@vercel/blob');

// Vercel's Node runtime only auto-parses req.body into a Buffer when the
// request's Content-Type is application/octet-stream (image/* isn't in its
// parse table and would leave req.body unusable) — so the client sends the
// wire Content-Type as octet-stream and passes the real image type via the
// X-File-Type header instead.
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
const MAX_BYTES = 4 * 1024 * 1024; // stay under Vercel's 4.5MB request body limit

export default async function handler(req, res) {
  // Allow requests from your website
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentType = (req.headers['x-file-type'] || '').split(';')[0].trim();
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return res.status(400).json({ error: 'Unsupported image type. Use JPEG, PNG, WEBP or GIF.' });
  }

  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) {
    return res.status(400).json({ error: 'No image data received' });
  }
  if (body.length > MAX_BYTES) {
    return res.status(413).json({ error: 'Photo is too large — please use one under 4MB' });
  }

  try {
    const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const blob = await put(filename, body, { access: 'public', contentType });
    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: 'Upload failed' });
  }
}
