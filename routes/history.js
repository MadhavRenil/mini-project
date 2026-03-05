const express = require('express');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, source, destination, start_date, end_date, modes, distance_km, duration_minutes, estimated_cost, itinerary_json, created_at
    FROM travel_history
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.session.userId);
  const history = rows.map((r) => ({
    id: r.id,
    source: r.source,
    destination: r.destination,
    start_date: r.start_date,
    end_date: r.end_date,
    modes: safeParseArray(r.modes),
    distance_km: r.distance_km,
    duration_minutes: r.duration_minutes,
    estimated_cost: r.estimated_cost,
    itinerary_json: safeParseObject(r.itinerary_json),
    created_at: r.created_at
  }));
  res.json({ history });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM travel_history WHERE id = ? AND user_id = ?');
  const result = stmt.run(req.params.id, req.session.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;

function safeParseArray(str) {
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function safeParseObject(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}
