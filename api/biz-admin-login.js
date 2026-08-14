const crypto = require('crypto');

function signingKey() {
  return crypto.createHash('sha256').update(String(process.env.BIZ_ADMIN_KEY) + ':session').digest();
}

function makeToken() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', signingKey()).update(ts).digest('hex');
  return ts + '.' + sig;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://hvpetvilla.in');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { passcode } = req.body || {};
  if (!process.env.BIZ_ADMIN_KEY || passcode !== process.env.BIZ_ADMIN_KEY) {
    return res.status(401).json({ error: 'Incorrect passcode' });
  }

  return res.status(200).json({ token: makeToken() });
}
