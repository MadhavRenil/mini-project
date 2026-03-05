const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

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
    req.session.userId = result.lastInsertRowid;
    req.session.userEmail = email;
    req.session.userName = name || email;
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
  req.session.userId = row.id;
  req.session.userEmail = row.email;
  req.session.userName = row.name || row.email;
  res.json({
    success: true,
    user: { id: row.id, email: row.email, name: row.name || row.email }
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ user: null });
  }
  const db = getDb();
  const row = db.prepare(
    'SELECT id, email, name, role FROM users WHERE id = ?'
  ).get(req.session.userId);
  if (!row) return res.json({ user: null });
  res.json({
    user: { id: row.id, email: row.email, name: row.name || row.email, role: row.role }
  });
});

module.exports = router;
