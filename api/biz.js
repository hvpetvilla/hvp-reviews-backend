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

// Separate signing key from the shop's admin token, so a shop passcode can
// never mint a token this endpoint accepts, and vice versa.
function verifyBizToken(token) {
  if (!process.env.BIZ_ADMIN_KEY || !token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [ts, sig] = parts;
  const key = crypto.createHash('sha256').update(String(process.env.BIZ_ADMIN_KEY) + ':session').digest();
  const expected = crypto.createHmac('sha256', key).update(ts).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  const age = Date.now() - Number(ts);
  return age >= 0 && age < 60 * 60 * 1000; // 1 hour session
}

// ── Schemas ──

const entrySchema = new mongoose.Schema({
  item: String, partner: String, date: String,
  amount: { type: Number, default: 0 }, revenue: { type: Number, default: 0 },
  products: [{
    name: String, qty: Number, cost: Number, cpu: Number,
    sales: [{ qty: Number, price: Number }]
  }],
  status: String, category: String, remarks: String
});

const vendorSchema = new mongoose.Schema({
  name: String, category: String, status: String, contact: String,
  phone: String, email: String, city: String, address: String, notes: String
});

const supplySchema = new mongoose.Schema({
  vendor: String, date: String, item: String, category: String,
  qty: Number, amount: Number, notes: String
});

// Named BizProduct (not Product) to avoid clobbering the shop's storefront
// Product model, which is registered by api/products.js in the same runtime.
const bizProductSchema = new mongoose.Schema({
  name: String, category: String, breed: String,
  mrp: Number, price: Number, cost: Number, stock: Number,
  avail: String, age: String, gender: String, desc: String, notes: String,
  photos: [String],
  addedOn: { type: Date, default: Date.now }
});

const requirementSchema = new mongoose.Schema({
  customer: String, mobile: String, requirement: String, category: String, budget: Number,
  status: String, priority: String, dateReq: String, dateDone: String, remarks: String,
  addedOn: { type: Date, default: Date.now }
});

// Singleton — only one document ever exists in this collection
const priceCompareSchema = new mongoose.Schema({
  products: [String], vendors: [String],
  prices: { type: mongoose.Schema.Types.Mixed, default: {} } // key format 'Vendor|||Product'
});

// Singleton
const bizSettingsSchema = new mongoose.Schema({
  name: { type: String, default: 'HV Petvilla' },
  phone: String, email: String, website: String, instagram: String, address: String,
  gst: String, logo: String, footer: String, currency: { type: String, default: '₹' },
  invPrefix: { type: String, default: 'INV-' }, ordPrefix: { type: String, default: 'ORD-' },
  invCounter: { type: Number, default: 1 }
});

const invoiceSchema = new mongoose.Schema({
  invNumber: String, ordNumber: String, ordDate: String, ordStatus: String, payType: String,
  customer: { name: String, email: String, mobile: String, address: String, city: String, state: String, pin: String },
  pets: [{ category: String, species: String, mutation: String, gender: String, age: String, petId: String, qty: Number, price: Number, amount: Number }],
  charges: { petTotal: Number, discType: String, discVal: Number, disc: Number, gstPct: Number, gst: Number, shipping: Number, packing: Number, other: Number, grand: Number },
  payment: { advance: Number, remaining: Number, method: String, txnId: String, status: String },
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

const Entry = mongoose.models.Entry || mongoose.model('Entry', entrySchema);
const Vendor = mongoose.models.Vendor || mongoose.model('Vendor', vendorSchema);
const Supply = mongoose.models.Supply || mongoose.model('Supply', supplySchema);
const BizProduct = mongoose.models.BizProduct || mongoose.model('BizProduct', bizProductSchema);
const Requirement = mongoose.models.Requirement || mongoose.model('Requirement', requirementSchema);
const PriceCompare = mongoose.models.PriceCompare || mongoose.model('PriceCompare', priceCompareSchema);
const BizSettings = mongoose.models.BizSettings || mongoose.model('BizSettings', bizSettingsSchema);
const Invoice = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);

const LIST_MODELS = { entries: Entry, vendors: Vendor, supplies: Supply, products: BizProduct, requirements: Requirement };
const SINGLETON_MODELS = { settings: BizSettings, pricecompare: PriceCompare };
const SINGULAR_KEY = { entries: 'entry', vendors: 'vendor', supplies: 'supply', products: 'product', requirements: 'requirement', invoices: 'invoice' };

const MAX_PHOTO_LEN = 500_000;  // base64 chars, per product photo
const MAX_LOGO_LEN = 2_000_000; // base64 chars, business logo

function capProductPhotos(body) {
  const photos = Array.isArray(body.photos)
    ? body.photos.slice(0, 3).map(p => String(p).slice(0, MAX_PHOTO_LEN))
    : [];
  return { ...body, photos };
}

// Atomically claims the next invoice number so two concurrent saves from
// different devices can never collide — the increment and the read happen
// as one Mongo operation instead of the client's old read-then-write.
async function nextInvoiceNumber() {
  const s = await BizSettings.findOneAndUpdate(
    {}, { $inc: { invCounter: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const seq = s.invCounter - 1; // pre-increment value = the number just claimed
  const now = new Date();
  const dt = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return (s.invPrefix || 'INV-') + dt + String(seq).padStart(4, '0');
}

async function handleList(Model, resource, req, res, id) {
  if (req.method === 'GET') {
    if (id) {
      const doc = await Model.findById(id);
      if (!doc) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(doc);
    }
    const docs = await Model.find().sort({ _id: -1 });
    return res.status(200).json(docs);
  }
  if (req.method === 'POST') {
    let body = req.body || {};
    if (resource === 'products') body = capProductPhotos(body);
    const doc = new Model(body);
    await doc.save();
    return res.status(200).json({ success: true, [SINGULAR_KEY[resource]]: doc });
  }
  if (req.method === 'PUT') {
    if (!id) return res.status(400).json({ error: 'id is required' });
    let body = req.body || {};
    if (resource === 'products') body = capProductPhotos(body);
    const doc = await Model.findByIdAndUpdate(id, body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ success: true, [SINGULAR_KEY[resource]]: doc });
  }
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id is required' });
    await Model.findByIdAndDelete(id);
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleSingleton(Model, resource, req, res) {
  if (req.method === 'GET') {
    let doc = await Model.findOne();
    if (!doc) doc = await Model.create({});
    return res.status(200).json(doc);
  }
  if (req.method === 'PUT') {
    const body = { ...(req.body || {}) };
    if (resource === 'settings') {
      if (typeof body.logo === 'string') body.logo = body.logo.slice(0, MAX_LOGO_LEN);
      // invCounter CAN be set here -- the app's Settings screen has a
      // legitimate manual "reset/renumber invoices" field. Concurrent
      // invoice creation stays race-free regardless, since POST always
      // claims its number via an atomic $inc (see nextInvoiceNumber),
      // independent of whatever value a settings edit last wrote.
      if (body.invCounter !== undefined) {
        const n = Number(body.invCounter);
        if (!Number.isFinite(n) || n < 1) delete body.invCounter;
        else body.invCounter = Math.floor(n);
      }
    }
    const doc = await Model.findOneAndUpdate({}, body, { upsert: true, new: true, setDefaultsOnInsert: true });
    return res.status(200).json(doc);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleInvoices(req, res, id) {
  if (req.method === 'GET') {
    if (id) {
      const doc = await Invoice.findById(id);
      if (!doc) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(doc);
    }
    const docs = await Invoice.find().sort({ _id: -1 });
    return res.status(200).json(docs);
  }
  if (req.method === 'POST') {
    const body = req.body || {};
    body.invNumber = await nextInvoiceNumber();
    const doc = new Invoice(body);
    await doc.save();
    return res.status(200).json({ success: true, invoice: doc });
  }
  if (req.method === 'PUT') {
    if (!id) return res.status(400).json({ error: 'id is required' });
    const body = { ...(req.body || {}) };
    delete body.invNumber; // immutable once assigned
    const doc = await Invoice.findByIdAndUpdate(id, body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ success: true, invoice: doc });
  }
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id is required' });
    await Invoice.findByIdAndDelete(id);
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// One-time migration helper: bulk-imports a JSON export of the real data
// that was previously sitting in the source app's browser localStorage/
// IndexedDB. Meant to be called once, then the resource can be removed.
async function handleImport(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const data = req.body || {};
  const imported = {};

  const stripLocalId = arr => (Array.isArray(arr) ? arr : []).map(({ id, ...rest }) => rest);

  if (Array.isArray(data.hv_entries) && data.hv_entries.length) {
    imported.entries = (await Entry.insertMany(stripLocalId(data.hv_entries))).length;
  }
  if (Array.isArray(data.hv_vendors) && data.hv_vendors.length) {
    imported.vendors = (await Vendor.insertMany(data.hv_vendors)).length;
  }
  if (Array.isArray(data.hv_supplies) && data.hv_supplies.length) {
    imported.supplies = (await Supply.insertMany(data.hv_supplies)).length;
  }
  if (Array.isArray(data.hvp_products) && data.hvp_products.length) {
    imported.products = (await BizProduct.insertMany(data.hvp_products)).length;
  }
  if (Array.isArray(data.hvp_requirements) && data.hvp_requirements.length) {
    imported.requirements = (await Requirement.insertMany(data.hvp_requirements)).length;
  }
  if (data.hvp_pricecompare && ((data.hvp_pricecompare.products || []).length || (data.hvp_pricecompare.vendors || []).length)) {
    await PriceCompare.findOneAndUpdate({}, data.hvp_pricecompare, { upsert: true });
    imported.pricecompare = 'imported';
  }
  if (data.settings) {
    await BizSettings.findOneAndUpdate({}, data.settings, { upsert: true });
    imported.settings = 'imported';
  }
  if (Array.isArray(data.invoices) && data.invoices.length) {
    imported.invoices = (await Invoice.insertMany(stripLocalId(data.invoices))).length;
  }

  return res.status(200).json({ success: true, imported });
}

export default async function handler(req, res) {
  // Locked to the site origin rather than '*' — unlike the public shop/review
  // endpoints, this one carries private financial and customer data.
  res.setHeader('Access-Control-Allow-Origin', 'https://hvpetvilla.in');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Biz-Admin-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Every method, including GET, requires the business admin token — this
  // data is private, unlike the public shop's product/review listings.
  if (!verifyBizToken(req.headers['x-biz-admin-key'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await connectDB();
    const { resource, id } = req.query;

    if (resource === 'import') return await handleImport(req, res);
    if (resource === 'invoices') return await handleInvoices(req, res, id);
    if (SINGLETON_MODELS[resource]) return await handleSingleton(SINGLETON_MODELS[resource], resource, req, res);
    if (LIST_MODELS[resource]) return await handleList(LIST_MODELS[resource], resource, req, res, id);

    return res.status(400).json({ error: 'Unknown or missing resource' });
  } catch (err) {
    console.error('DB Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
