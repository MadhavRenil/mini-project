const express = require('express');

// Simulated local events by city; real app would use Eventbrite, Ticketmaster, or similar API
const EVENTS_BY_CITY = {
  'new york': [
    { id: 1, name: 'Broadway Show: Hamilton', date: '2025-03-15', type: 'Culture', venue: 'Richard Rodgers Theatre' },
    { id: 2, name: 'Central Park Summer Festival', date: '2025-06-20', type: 'Festival', venue: 'Central Park' },
    { id: 3, name: 'NYC Food & Wine Festival', date: '2025-10-05', type: 'Food', venue: 'Various' }
  ],
  'los angeles': [
    { id: 4, name: 'Hollywood Bowl Concert Series', date: '2025-07-10', type: 'Music', venue: 'Hollywood Bowl' },
    { id: 5, name: 'LA Art Walk', date: '2025-04-12', type: 'Culture', venue: 'Downtown LA' }
  ],
  'chicago': [
    { id: 6, name: 'Lollapalooza', date: '2025-08-01', type: 'Festival', venue: 'Grant Park' },
    { id: 7, name: 'Chicago Jazz Festival', date: '2025-09-01', type: 'Music', venue: 'Millennium Park' }
  ],
  'miami': [
    { id: 8, name: 'Art Basel Miami Beach', date: '2025-12-04', type: 'Culture', venue: 'Miami Beach' },
    { id: 9, name: 'Ultra Music Festival', date: '2025-03-28', type: 'Music', venue: 'Bayfront Park' }
  ],
  'san francisco': [
    { id: 10, name: 'Outside Lands', date: '2025-08-08', type: 'Festival', venue: 'Golden Gate Park' }
  ],
  'las vegas': [
    { id: 11, name: 'CES', date: '2026-01-06', type: 'Tech', venue: 'Las Vegas Convention Center' }
  ],
  'boston': [
    { id: 12, name: 'Boston Marathon', date: '2025-04-21', type: 'Sports', venue: 'Boston' }
  ]
};

function normalizeCity(name) {
  return (name || '').toLowerCase().trim();
}

const router = express.Router();

router.get('/', (req, res) => {
  const city = normalizeCity(req.query.city || req.query.destination || '');
  if (!city) {
    return res.json({ events: [], message: 'Provide city or destination query' });
  }
  let events = EVENTS_BY_CITY[city] || [];
  const type = (req.query.type || '').toLowerCase();
  if (type) {
    events = events.filter(e => (e.type || '').toLowerCase() === type);
  }
  res.json({ city, events });
});

router.get('/all', (req, res) => {
  const all = Object.entries(EVENTS_BY_CITY).flatMap(([city, events]) =>
    events.map(e => ({ ...e, city }))
  );
  res.json({ events: all });
});

module.exports = router;
