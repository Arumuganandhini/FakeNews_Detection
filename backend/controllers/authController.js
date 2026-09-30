const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// The signup page asks for a valid email and at least eight characters, but
// the server accepted anything: a missing password reached bcrypt and came
// back as a server error, and "User@x.com" could sign up and then fail to log
// in as "user@x.com". The server now holds the same rules as the page.
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

// Signup
exports.signup = async (req, res) => {
  try {
    const email = normaliseEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Your password needs at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ email, password: hashedPassword });
    await user.save();

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({
      message: 'User created successfully',
      token,
      userId: user._id
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Error creating user' });
  }
};

// Login
exports.login = async (req, res) => {
  try {
    const email = normaliseEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter your email and password.' });
    }

    // Accounts created before emails were normalised may be stored with capitals.
    const user = await User.findOne({ email })
      || await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      userId: user._id,
      interests: user.interests || []
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Error during login' });
  }
};

// Verify token
exports.verify = async (req, res) => {
  try {
    // The user is already attached to the request by the auth middleware
    const user = req.user;

    res.json({
      userId: user._id,
      email: user.email,
      interests: user.interests || []
    });
  } catch (err) {
    console.error('Token verification error:', err.message);
    res.status(500).json({ error: 'Error verifying token' });
  }
};
