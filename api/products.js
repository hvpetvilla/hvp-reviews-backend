const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

// Reuse connection across calls
let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(MONGODB_URI);
  isConnected = true;
}

// Mirrors the BizProduct schema in api/biz.js. BizTrack's internal "Products"
// catalogue (Birds, Reptiles, Feed & Medicine, Equipment, ...) is now the
// single source for everything shown on the website — this endpoint only
// reads and republishes it publicly. All writes happen through BizTrack via
// /api/biz?resource=products; there is no admin path here anymore.
const bizProductSchema = new mongoose.Schema({
  name: String, category: String, breed: String,
  mrp: Number, price: Number, cost: Number, stock: Number,
  avail: String, age: String, gender: String, desc: String, notes: String,
  photos: [String],
  addedOn: { type: Date, default: Date.now }
});
const BizProduct = mongoose.models.BizProduct || mongoose.model('BizProduct', bizProductSchema);

// Categories that represent live animals go to the website's Live Pets
// section; everything else (food, equipment, accessories...) goes to Shop.
const PET_CATEGORIES = ['Birds', 'Reptiles', 'Small Mammals', 'Aquatics', 'Exotic'];

// Every status an item can carry is shown on the website — Available items
// with their normal buy/enquire action, the rest with a status badge and a
// WhatsApp action instead (see shop.html). Anything outside this list (e.g.
// a blank avail on a freshly-created item) stays unpublished.
const PUBLIC_STATUSES = ['Available', 'Out of Stock - Raise Order Request', 'Display', 'Sold'];

export default async function handler(req, res) {
  // Allow requests from your website
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await connectDB();
    const docs = await BizProduct.find({ avail: { $in: PUBLIC_STATUSES } }).sort({ addedOn: -1 });
    // cost (purchase price) and notes are internal-only — never expose them
    // on the public storefront API.
    const products = docs.map(p => ({
      _id: p._id,
      name: p.name,
      category: p.category,
      section: PET_CATEGORIES.includes(p.category) ? 'pets' : 'shop',
      avail: p.avail,
      breed: p.breed || '',
      age: p.age || '',
      gender: p.gender || '',
      price: p.price,
      mrp: p.mrp,
      desc: p.desc || '',
      photos: Array.isArray(p.photos) ? p.photos : []
    }));
    return res.status(200).json(products);
  } catch (err) {
    console.error('DB Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
