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

const CATEGORIES = ['food', 'accessories', 'cages', 'other'];

const productSchema = new mongoose.Schema({
  name: String,
  cat: String,
  emoji: String,
  imgUrl: String,
  desc: String,
  price: Number,
  date: { type: Date, default: Date.now }
});

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

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
      const products = await Product.find().sort({ date: 1 });
      return res.status(200).json(products);
    }

    if (req.method === 'POST') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { name, cat, emoji, imgUrl, desc, price } = req.body || {};
      if (!name || !price) {
        return res.status(400).json({ error: 'name and price are required' });
      }
      const numPrice = Number(price);
      if (!Number.isFinite(numPrice) || numPrice <= 0) {
        return res.status(400).json({ error: 'price must be a positive number' });
      }
      const product = new Product({
        name: String(name).slice(0, 150),
        cat: CATEGORIES.includes(cat) ? cat : 'other',
        emoji: emoji ? String(emoji).slice(0, 8) : '🐾',
        imgUrl: imgUrl ? String(imgUrl).slice(0, 2_000_000) : '',
        desc: desc ? String(desc).slice(0, 500) : '',
        price: numPrice
      });
      await product.save();
      return res.status(200).json({ success: true, product });
    }

    if (req.method === 'PUT') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { name, cat, emoji, imgUrl, desc, price } = req.body || {};
      if (!name || !price) {
        return res.status(400).json({ error: 'name and price are required' });
      }
      const numPrice = Number(price);
      if (!Number.isFinite(numPrice) || numPrice <= 0) {
        return res.status(400).json({ error: 'price must be a positive number' });
      }
      const product = await Product.findByIdAndUpdate(id, {
        name: String(name).slice(0, 150),
        cat: CATEGORIES.includes(cat) ? cat : 'other',
        emoji: emoji ? String(emoji).slice(0, 8) : '🐾',
        imgUrl: imgUrl ? String(imgUrl).slice(0, 2_000_000) : '',
        desc: desc ? String(desc).slice(0, 500) : '',
        price: numPrice
      }, { new: true });
      if (!product) return res.status(404).json({ error: 'Product not found' });
      return res.status(200).json({ success: true, product });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id is required' });
      await Product.findByIdAndDelete(id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('DB Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
