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
    const docs = await BizProduct.find({ avail: 'Available' }).sort({ addedOn: -1 });
    // cost (purchase price), mrp and notes are internal-only — never expose
    // them on the public storefront API. Sending mrp alongside price would
    // let anyone back out the discount/margin, so it's dropped here too,
    // not just hidden in the UI.
    const products = docs.map(p => ({
      _id: p._id,
      name: p.name,
      category: p.category,
      section: PET_CATEGORIES.includes(p.category) ? 'pets' : 'shop',
      breed: p.breed || '',
      age: p.age || '',
      gender: p.gender || '',
      price: p.price,
      desc: p.desc || '',
      photos: Array.isArray(p.photos) ? p.photos : []
    }));
    return res.status(200).json(products);
  } catch (err) {
    console.error('DB Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
