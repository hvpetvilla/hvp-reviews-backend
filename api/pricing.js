const mongoose = require('mongoose');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;

// Reuse connection across calls
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(MONGODB_URI);
  isConnected = true;
}

// Verifies a signed session token from /api/admin-login, rather than
// comparing against the raw admin passcode (which would otherwise have
// to be sent, and therefore visible, on every admin request).
function verifyToken(token) {
  if (!process.env.ADMIN_KEY || !token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [ts, sig] = parts;
  const key = crypto.createHash('sha256').update(String(process.env.ADMIN_KEY) + ':session').digest();
  const expected = crypto.createHmac('sha256', key).update(ts).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  const age = Date.now() - Number(ts);
  return age >= 0 && age < 12 * 60 * 60 * 1000; // 12 hour session
}

const pricingTierSchema = new mongoose.Schema({
  label: String,
  withoutFood: Number,
  withFood: Number,
  note: String,
  order: { type: Number, default: 0 },
  date: { type: Date, default: Date.now }
});

const PricingTier = mongoose.models.PricingTier || mongoose.model('PricingTier', pricingTierSchema);

function isAdmin(req) {
  return verifyToken(req.headers['x-admin-key']);
}

export default async function handler(req, res) {
  // Allow requests from your website
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connectDB();

    if (req.method === 'GET') {
      const tiers = await PricingTier.find().sort({ order: 1, date: 1 });
      return res.status(200).json(tiers);
    }

    if (req.method === 'POST') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { label, withoutFood, withFood, note, order } = req.body || {};
      if (!label || withoutFood == null || withFood == null) {
        return res.status(400).json({ error: 'label, withoutFood and withFood are required' });
      }
      const numWithout = Number(withoutFood);
      const numWith = Number(withFood);
      if (!Number.isFinite(numWithout) || numWithout < 0 || !Number.isFinite(numWith) || numWith < 0) {
        return res.status(400).json({ error: 'withoutFood and withFood must be non-negative numbers' });
      }
      const tier = new PricingTier({
        label: String(label).slice(0, 150),
        withoutFood: numWithout,
        withFood: numWith,
        note: note ? String(note).slice(0, 300) : '',
        order: Number.isFinite(Number(order)) ? Number(order) : 0
      });
      await tier.save();
      return res.status(200).json({ success: true, tier });
    }

    if (req.method === 'PUT') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { label, withoutFood, withFood, note, order } = req.body || {};
      if (!label || withoutFood == null || withFood == null) {
        return res.status(400).json({ error: 'label, withoutFood and withFood are required' });
      }
      const numWithout = Number(withoutFood);
      const numWith = Number(withFood);
      if (!Number.isFinite(numWithout) || numWithout < 0 || !Number.isFinite(numWith) || numWith < 0) {
        return res.status(400).json({ error: 'withoutFood and withFood must be non-negative numbers' });
      }
      const tier = await PricingTier.findByIdAndUpdate(id, {
        label: String(label).slice(0, 150),
        withoutFood: numWithout,
        withFood: numWith,
        note: note ? String(note).slice(0, 300) : '',
        order: Number.isFinite(Number(order)) ? Number(order) : 0
      }, { new: true });
      if (!tier) return res.status(404).json({ error: 'Pricing tier not found' });
      return res.status(200).json({ success: true, tier });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id is required' });
      await PricingTier.findByIdAndDelete(id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('DB Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
