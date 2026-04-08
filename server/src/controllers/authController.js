const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendVerificationEmail } = require('../config/email');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

exports.register = async (req, res, next) => {
  try {
    const { email, username, password, role, displayName } = req.body;
    if (!email || !username || !password || !role || !displayName) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!['educator', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Role must be educator or student' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existingEmail = await User.findByEmail(email);
    if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

    const existingUsername = await User.findByUsername(username);
    if (existingUsername) return res.status(409).json({ error: 'Username already taken' });

    const { user, verificationToken } = await User.create({ email, username, password, role, displayName });

    try {
      await sendVerificationEmail(email, verificationToken);
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr.message);
    }

    const token = generateToken(user);
    res.status(201).json({
      message: 'Account created. Please check your email to verify your account.',
      token,
      user: { id: user.id, email: user.email, username: user.username, role: user.role, displayName: user.display_name, avatarColor: user.avatar_color, isVerified: user.is_verified },
    });
  } catch (err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const isMatch = await User.comparePassword(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid email or password' });

    const token = generateToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, username: user.username, role: user.role, displayName: user.display_name, avatarColor: user.avatar_color, isVerified: user.is_verified },
    });
  } catch (err) { next(err); }
};

exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      user: { id: user.id, email: user.email, username: user.username, role: user.role, displayName: user.display_name, avatarColor: user.avatar_color, isVerified: user.is_verified },
    });
  } catch (err) { next(err); }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { displayName, avatarColor } = req.body;
    const user = await User.updateProfile(req.user.id, { displayName, avatarColor });
    res.json({ user: { id: user.id, email: user.email, username: user.username, role: user.role, displayName: user.display_name, avatarColor: user.avatar_color, isVerified: user.is_verified } });
  } catch (err) { next(err); }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Verification token is required' });
    const user = await User.verifyEmail(token);
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification token' });
    res.json({ message: 'Email verified successfully', user });
  } catch (err) { next(err); }
};

exports.resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const { user, token } = await User.setNewVerificationToken(email);
    if (!user) return res.status(400).json({ error: 'Email not found or already verified' });
    await sendVerificationEmail(email, token);
    res.json({ message: 'Verification email sent' });
  } catch (err) { next(err); }
};
