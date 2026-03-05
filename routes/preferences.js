const express = require('express');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT preferred_modes, budget_min, budget_max, interests FROM user_preferences WHERE user_id = ?'
  ).get(req.session.userId);
  if (!row) {
    return res.json({
      preferred_modes: [],
      budget_min: null,
      budget_max: null,
      interests: []
    });
  }
  res.json({
    preferred_modes: safeJsonParse(row.preferred_modes, []),
    budget_min: row.budget_min,
    budget_max: row.budget_max,
    interests: safeJsonParse(row.interests, [])
  });
});

router.put('/', requireAuth, (req, res) => {
  const { preferred_modes, budget_min, budget_max, interests } = req.body;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO user_preferences (user_id, preferred_modes, budget_min, budget_max, interests, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      preferred_modes = excluded.preferred_modes,
      budget_min = excluded.budget_min,
      budget_max = excluded.budget_max,
      interests = excluded.interests,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    req.session.userId,
    JSON.stringify(Array.isArray(preferred_modes) ? preferred_modes : []),
    budget_min ?? null,
    budget_max ?? null,
    JSON.stringify(Array.isArray(interests) ? interests : []),
    new Date().toISOString()
  );
  res.json({ success: true });
});

function safeJsonParse(str, def) {
  if (str == null) return def;
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : def;
  } catch (_) {
    return def;
  }
}

module.exports = router;
