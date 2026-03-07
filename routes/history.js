const express = require('express');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const travelHistoryRows = db.prepare(`
    SELECT id, source, destination, start_date, end_date, modes, distance_km, duration_minutes, estimated_cost, itinerary_json, created_at
    FROM travel_history
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId).map((r) => ({
    id: `history-${r.id}`,
    source: r.source,
    destination: r.destination,
    start_date: r.start_date,
    end_date: r.end_date,
    modes: safeParseArray(r.modes),
    distance_km: r.distance_km,
    duration_minutes: r.duration_minutes,
    estimated_cost: r.estimated_cost,
    itinerary_json: safeParseObject(r.itinerary_json),
    created_at: r.created_at,
    source_type: 'saved',
    status: 'saved'
  }));

  const bookingRows = db.prepare(`
    SELECT id, source, destination, travel_date, num_travelers, selected_option_json, total_cost, payment_ref, status, created_at
    FROM bookings
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);

  const bookingHistory = bookingRows.map((row) => {
    const selection = safeParseObject(row.selected_option_json) || {};
    const modes = Array.isArray(selection.modes)
      ? selection.modes
      : Array.isArray(selection.legs)
        ? selection.legs.map((leg) => leg.modeName || leg.mode).filter(Boolean)
        : [];

    return {
      id: `booking-${row.id}`,
      source: row.source,
      destination: row.destination,
      start_date: row.travel_date || null,
      end_date: selection.return_date || null,
      modes,
      distance_km: selection.total_distance_km ?? null,
      duration_minutes: selection.total_duration_minutes ?? null,
      estimated_cost: row.total_cost ?? selection.total_with_hotel ?? selection.total_cost ?? null,
      itinerary_json: Array.isArray(selection.final_itinerary) ? selection.final_itinerary : selection,
      created_at: row.created_at,
      source_type: 'booking',
      status: row.status || 'confirmed',
      payment_ref: row.payment_ref || null,
      num_travelers: row.num_travelers || 1
    };
  });

  const history = dedupeTrips([...bookingHistory, ...travelHistoryRows])
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

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

function dedupeTrips(items) {
  const seen = new Set();
  return items.filter((item) => {
    const keyBase = [
      item.source || '',
      item.destination || '',
      normalizeDate(item.start_date),
      normalizeMoney(item.estimated_cost),
      JSON.stringify(item.modes || [])
    ].join('|');
    const key = keyBase !== '||||'
      ? keyBase
      : `payment:${item.payment_ref || ''}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

function normalizeMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : '';
}
