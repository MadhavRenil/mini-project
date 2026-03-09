const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

function setRegisteredSession(req, user) {
  req.session.isGuest = false;
  req.session.userId = user.id;
  req.session.userEmail = user.email;
  req.session.userName = user.name || user.email;
  req.session.userRole = user.role || 'user';
}

function setGuestSession(req) {
  req.session.isGuest = true;
  req.session.userId = null;
  req.session.userEmail = null;
  req.session.userName = 'Guest';
  req.session.userRole = 'guest';
}

function clearSession(req) {
  if (!req.session) return;
  req.session.isGuest = false;
  req.session.userId = null;
  req.session.userEmail = null;
  req.session.userName = null;
  req.session.userRole = null;
}

router.post('/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
    );
    const result = stmt.run(email.toLowerCase().trim(), hash, name || null);
    setRegisteredSession(req, {
      id: result.lastInsertRowid,
      email,
      name: name || email,
      role: 'user'
    });
    res.status(201).json({
      success: true,
      user: { id: result.lastInsertRowid, email, name: name || email }
    });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Email already registered' });
    }
    throw e;
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const db = getDb();
  const row = db.prepare(
    'SELECT id, email, password_hash, name FROM users WHERE email = ?'
  ).get(email.toLowerCase().trim());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  setRegisteredSession(req, {
    id: row.id,
    email: row.email,
    name: row.name || row.email,
    role: 'user'
  });
  res.json({
    success: true,
    user: { id: row.id, email: row.email, name: row.name || row.email }
  });
});

router.post('/guest', (req, res) => {
  setGuestSession(req);
  res.json({
    success: true,
    user: {
      id: null,
      email: null,
      name: 'Guest',
      role: 'guest',
      isGuest: true
    }
  });
});

router.post('/logout', (req, res) => {
  clearSession(req);
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.isGuest) {
    return res.json({
      user: {
        id: null,
        email: null,
        name: req.session.userName || 'Guest',
        role: 'guest',
        isGuest: true
      }
    });
  }
  if (!req.session || !req.session.userId) {
    return res.json({ user: null });
  }
  const db = getDb();
  const row = db.prepare(
    'SELECT id, email, name, role FROM users WHERE id = ?'
  ).get(req.session.userId);
  if (!row) return res.json({ user: null });
  res.json({
    user: { id: row.id, email: row.email, name: row.name || row.email, role: row.role, isGuest: false }
  });
});

module.exports = router;
