const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

// Routes
const newsRoutes = require('./routes/newsRoutes');
const aiRoutes = require('./routes/aiRoutes');
const authRoutes = require('./routes/authRoutes'); // New
const trackingRoutes = require('./routes/trackingRoutes');
const articleHistoryRoutes = require('./routes/articleHistory');
const userRoutes = require('./routes/userRoutes');
const articleFeedbackRoutes = require('./routes/articleFeedbackRoutes');

// DB Connection
const connectDB = require('./utils/db'); // New

// Initialize models
require('./models');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// A screenshot arrives as base64 inside the JSON body, and base64 inflates by
// about a third: the 8 MB image the upload endpoint accepts is roughly 11 MB on
// the wire. The default 100 kB limit would reject every screenshot with a
// parser error before the route ever ran.
app.use(bodyParser.json({ limit: '12mb' }));

// Database
connectDB().then(() => {
  console.log('Models initialized');
}).catch(err => {
  console.error('Failed to initialize models:', err);
});

// Routes
app.use('/api/news', newsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/auth', authRoutes); // New
app.use('/api/tracking', trackingRoutes);
app.use('/api/article-history', articleHistoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/article-feedback', articleFeedbackRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});