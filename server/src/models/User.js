const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class User {
  static async create({ email, username, password, role, displayName }) {
    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const colors = ['#7c5cfc','#22d3ee','#f59e0b','#34d399','#f87171','#a78bfa','#fb923c','#38bdf8'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    const result = await db.query(
      `INSERT INTO users (email, username, password_hash, role, display_name, avatar_color, verification_token, verification_token_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, username, role, display_name, avatar_color, is_verified, created_at`,
      [email, username, passwordHash, role, displayName, avatarColor, verificationToken, tokenExpires]
    );
    return { user: result.rows[0], verificationToken };
  }

  static async findByEmail(email) {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  }

  static async findByUsername(username) {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0];
  }

  static async findById(id) {
    const result = await db.query(
      'SELECT id, email, username, role, display_name, avatar_color, is_verified, created_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async verifyEmail(token) {
    const result = await db.query(
      `UPDATE users SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE verification_token = $1 AND verification_token_expires > CURRENT_TIMESTAMP
       RETURNING id, email, username, role, display_name, is_verified`,
      [token]
    );
    return result.rows[0];
  }

  static async comparePassword(plainText, hash) {
    return bcrypt.compare(plainText, hash);
  }

  static async updateProfile(id, { displayName, avatarColor }) {
    const result = await db.query(
      `UPDATE users SET display_name = COALESCE($1, display_name), avatar_color = COALESCE($2, avatar_color), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING id, email, username, role, display_name, avatar_color, is_verified`,
      [displayName, avatarColor, id]
    );
    return result.rows[0];
  }

  static async setNewVerificationToken(email) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await db.query(
      `UPDATE users SET verification_token = $1, verification_token_expires = $2
       WHERE email = $3 AND is_verified = FALSE RETURNING id, email`,
      [token, expires, email]
    );
    return { user: result.rows[0], token };
  }
}

module.exports = User;
