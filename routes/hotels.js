const express = require('express');
const { fetchHotelsRealTime, HOTEL_TYPES } = require('../lib/apis');

const router = express.Router();

function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function rand() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORY_PROFILES = {
  budget: { min: 900, max: 3200, minRating: 6.1, maxRating: 8.2 },
  midrange: { min: 2800, max: 7000, minRating: 6.8, maxRating: 8.9 },
  luxury: { min: 7000, max: 22000, minRating: 7.6, maxRating: 9.6 },
  hostel: { min: 500, max: 1800, minRating: 6.0, maxRating: 8.4 },
  apartment: { min: 2200, max: 9000, minRating: 6.5, maxRating: 9.0 }
};

function inferCategory(price) {
  const p = Number(price) || 0;
  if (p <= 1800) return 'hostel';
  if (p <= 3200) return 'budget';
  if (p <= 7000) return 'midrange';
  if (p <= 9000) return 'apartment';
  return 'luxury';
}

function cityLabel(destination) {
  return (destination || 'City').trim().split(/\s+/).map(p => p[0] ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '').join(' ');
}

function buildSimulatedHotels({ destination, checkIn, checkOut, adults, hotelType }) {
  const seedKey = `${destination}|${checkIn}|${checkOut}|${adults}|${hotelType || ''}`;
  const rand = mulberry32(hashString(seedKey));
  const city = cityLabel(destination);
  const prefixes = ['Grand', 'Urban', 'Skyline', 'River', 'Central', 'Harbor', 'Lotus', 'Royal', 'Metro', 'Palm'];
  const suffixes = ['Residency', 'Suites', 'Retreat', 'Stay', 'Inn', 'Heights', 'House', 'Palace', 'Plaza', 'Haven'];
  const categories = ['budget', 'midrange', 'luxury', 'hostel', 'apartment'];
  const preferred = HOTEL_TYPES[hotelType] ? hotelType : null;
  const results = [];

  for (let i = 0; i < 25; i++) {
    let category = categories[Math.floor(rand() * categories.length)];
    if (preferred && rand() < 0.62) category = preferred;
    const profile = CATEGORY_PROFILES[category];
    const raw = profile.min + rand() * (profile.max - profile.min);
    const multiplier = adults > 2 ? (1 + (adults - 2) * 0.08) : 1;
    const price = Math.round((Math.round(raw / 100) * 100) * multiplier);
    const rating = (profile.minRating + rand() * (profile.maxRating - profile.minRating)).toFixed(1);
    const name = `${city} ${prefixes[Math.floor(rand() * prefixes.length)]} ${suffixes[Math.floor(rand() * suffixes.length)]}`;
    const distanceToCenter = (0.4 + rand() * 12).toFixed(1);
    const distanceToAirport = (4 + rand() * 26).toFixed(1);
    const cancellation = rand() > 0.35 ? 'Free cancellation' : 'Non-refundable';
    const payment = rand() > 0.5 ? 'Pay at property' : 'Pay now';
    results.push({
      id: `sim-${i + 1}-${hashString(`${seedKey}|${i}`).toString(16)}`,
      name,
      price,
      rating,
      currency: 'INR',
      category,
      distance_to_center_km: Number(distanceToCenter),
      distance_to_airport_km: Number(distanceToAirport),
      cancellation,
      payment,
      simulated: true
    });
  }
  return results.sort((a, b) => a.price - b.price);
}

router.get('/', async (req, res) => {
  const destination = req.query.destination || req.query.city || '';
  const checkin = req.query.checkin || req.query.check_in || '';
  const checkout = req.query.checkout || req.query.check_out || '';
  const adults = parseInt(req.query.adults, 10) || 1;
  const hotelType = req.query.hotel_type || req.query.type || '';
  if (!destination) {
    return res.json({ hotels: [], message: 'Provide destination' });
  }
  const checkIn = checkin || new Date().toISOString().slice(0, 10);
  const checkOut = checkout || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let hotels = await fetchHotelsRealTime(destination, checkIn, checkOut, adults);
  if (!hotels || hotels.length === 0) {
    hotels = buildSimulatedHotels({ destination, checkIn, checkOut, adults, hotelType });
  } else {
    hotels = hotels.map((h, i) => ({
      ...h,
      id: h.id || `rt-${i + 1}`,
      category: h.category || inferCategory(h.price),
      simulated: false
    })).sort((a, b) => (a.price || 0) - (b.price || 0));
  }
  res.json({ hotels, destination, checkIn, checkOut, adults, hotel_type: hotelType || null });
});

module.exports = router;
