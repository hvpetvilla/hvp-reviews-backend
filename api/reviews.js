const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

// Reuse connection across calls
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(MONGODB_URI);
  isConnected = true;
}

const reviewSchema = new mongoose.Schema({
  name: String,
  pet: String,
  rating: Number,
  message: String,
  img: String,
  date: { type: Date, default: Date.now }
});

const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);

export default async function handler(req, res) {
  // Allow requests from your website
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connectDB();

    if (req.method === 'GET') {
      const reviews = await Review.find().sort({ date: -1 });
      return res.status(200).json(reviews);
    }

    if (req.method === 'POST') {
      const { name, pet, rating, message, img } = req.body || {};
      if (!name || !message || !rating) {
        return res.status(400).json({ error: 'name, rating and message are required' });
      }
      const numRating = Number(rating);
      if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
        return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
      }
      const review = new Review({
        name: String(name).slice(0, 100),
        pet: pet ? String(pet).slice(0, 100) : '',
        rating: numRating,
        message: String(message).slice(0, 2000),
        img: img ? String(img).slice(0, 2_000_000) : ''
      });
      await review.save();
      return res.status(200).json({ success: true, review });
    }

    if (req.method === 'DELETE') {
      if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id is required' });
      await Review.findByIdAndDelete(id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('DB Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
