const express = require('express');
const { fetchEventsRealTime } = require('../lib/apis');

const router = express.Router();

function normalizeCity(name) {
  return (name || '').toLowerCase().trim();
}

function titleCase(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function buildIsoDate(baseDate, offsetDays) {
  const value = new Date(baseDate.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return value.toISOString().slice(0, 10);
}

function buildFallbackEvents(city, travelDate = null) {
  const cityLabel = titleCase(city || 'Destination');
  const seedDate = travelDate
    ? new Date(`${travelDate}T00:00:00`)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const baseDate = Number.isNaN(seedDate.getTime())
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    : seedDate;

  const templates = [
    {
      name: `${cityLabel} Night Market`,
      type: 'Food',
      venue: `Old Town ${cityLabel}`,
      offsetDays: 0,
      when: '6:30 PM'
    },
    {
      name: `${cityLabel} Live Music Session`,
      type: 'Music',
      venue: `${cityLabel} Waterfront`,
      offsetDays: 1,
      when: '8:00 PM'
    },
    {
      name: `${cityLabel} Local Culture Walk`,
      type: 'Culture',
      venue: `${cityLabel} Heritage District`,
      offsetDays: 2,
      when: '10:00 AM'
    }
  ];

  return templates.map((event, index) => ({
    id: `fallback-event-${index + 1}-${city.replace(/\s+/g, '-')}`,
    name: event.name,
    date: buildIsoDate(baseDate, event.offsetDays),
    when: event.when,
    type: event.type,
    venue: event.venue,
    source: 'fallback'
  }));
}

router.get('/', async (req, res) => {
  const city = normalizeCity(req.query.city || req.query.destination || '');
  const travelDate = req.query.travel_date || req.query.date || null;
  if (!city) {
    return res.json({ events: [], message: 'Provide city or destination query' });
  }

  const type = (req.query.type || '').toLowerCase().trim();
  let events = await fetchEventsRealTime(city, travelDate);
  let source = 'serpapi';

  if (!events || !events.length) {
    events = buildFallbackEvents(city, travelDate);
    source = 'fallback';
  }

  if (type) {
    events = events.filter((event) => String(event.type || '').toLowerCase() === type);
  }

  return res.json({ city, source, events });
});

router.get('/all', (req, res) => {
  const cities = ['goa', 'mumbai', 'delhi', 'bangalore'];
  const events = cities.flatMap((city) =>
    buildFallbackEvents(city).map((event) => ({
      ...event,
      city
    }))
  );

  return res.json({ events });
});

module.exports = router;
