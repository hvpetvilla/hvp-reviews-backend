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
  rating: Number,
  message: String,
  date: { type: Date, default: Date.now }
});

const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);

export default async function handler(req, res) {
  // Allow requests from your website
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
      const { name, rating, message } = req.body;
      const review = new Review({ name, rating, message });
      await review.save();
      return res.status(200).json({ success: true, review });
    }

  } catch (err) {
    console.error('DB Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
