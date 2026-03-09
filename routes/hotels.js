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
  return (destination || 'City').trim().split(/\s+/).map((part) => (part[0] ? part[0].toUpperCase() + part.slice(1).toLowerCase() : '')).join(' ');
}

function buildHotelImagePlaceholder(hotel) {
  const palette = hotel.simulated
    ? { start: '#2ec8ff', end: '#0b5fb4', label: 'Preview image' }
    : { start: '#f3a712', end: '#dd614a', label: 'Provider image' };
  const city = hotel.city || hotel.name || 'Hotel';
  const category = hotel.category || 'stay';
  const label = palette.label;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
    `  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${palette.start}" /><stop offset="100%" stop-color="${palette.end}" /></linearGradient></defs>`,
    '  <rect width="1280" height="720" fill="url(#g)" rx="44" />',
    '  <circle cx="1040" cy="140" r="110" fill="rgba(255,255,255,0.16)" />',
    '  <circle cx="1180" cy="620" r="190" fill="rgba(255,255,255,0.08)" />',
    '  <rect x="90" y="110" width="520" height="520" rx="36" fill="rgba(255,255,255,0.14)" />',
    '  <path d="M180 510 L290 360 L390 450 L520 280 L640 510 Z" fill="rgba(255,255,255,0.18)" />',
    '  <circle cx="540" cy="220" r="54" fill="rgba(255,255,255,0.22)" />',
    `  <text x="120" y="418" fill="rgba(255,255,255,0.88)" font-family="Arial, sans-serif" font-size="34">${city} | ${category}</text>`,
    `  <text x="120" y="592" fill="#ffffff" font-family="Arial, sans-serif" font-size="52" font-weight="700">${label}</text>`,
    '  <text x="120" y="648" fill="rgba(255,255,255,0.84)" font-family="Arial, sans-serif" font-size="28">Preview image generated when the hotel provider does not include enough photos.</text>',
    '</svg>'
  ].join('');
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function attachHotelGallery(hotel) {
  const images = Array.isArray(hotel.images) ? hotel.images.filter(Boolean) : [];
  if (hotel.image) images.unshift(hotel.image);
  const uniqueImages = [...new Set(images)];
  if (!uniqueImages.length) {
    uniqueImages.push(buildHotelImagePlaceholder(hotel));
  }
  return {
    ...hotel,
    image: uniqueImages[0] || null,
    images: uniqueImages
  };
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
    results.push(attachHotelGallery({
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
      source: 'simulated',
      source_label: 'Local RouteX estimate',
      review_word: 'Generated stay estimate',
      checkin_from: '12:00',
      checkout_until: '11:00',
      city,
      summary: `${name} is a generated ${category} stay estimate in ${city}.`,
      simulated: true
    }));
  }
  return results.sort((a, b) => a.price - b.price);
}

function buildHotelSummary(hotel, destination) {
  if (hotel.description) return hotel.description;
  if (hotel.summary) return hotel.summary;

  const city = cityLabel(destination || hotel.city || 'your destination');
  const category = hotel.category || inferCategory(hotel.price);
  const sourceLabel = hotel.source_label || (hotel.simulated ? 'RouteX estimate' : 'hotel API result');
  const ratingText = hotel.review_word
    ? ` Guest sentiment is ${hotel.review_word.toLowerCase()}.`
    : hotel.rating != null ? ` Current rating is ${Number(hotel.rating).toFixed(1)}/10.` : '';

  return `${hotel.name || 'This stay'} is a ${category} option in ${city}. Information shown here comes from ${sourceLabel}.${ratingText}`;
}

function buildHotelFacts(hotel) {
  const facts = [
    hotel.source_label || null,
    hotel.hotel_class ? `${hotel.hotel_class}-star class` : null,
    hotel.type || null,
    hotel.review_word && hotel.rating != null ? `${hotel.review_word} - ${Number(hotel.rating).toFixed(1)}/10` : null,
    !hotel.review_word && hotel.rating != null ? `${Number(hotel.rating).toFixed(1)}/10 guest rating` : null,
    hotel.review_count ? `${hotel.review_count} review${hotel.review_count === 1 ? '' : 's'}` : null,
    hotel.price ? `${hotel.currency || 'INR'} ${Number(hotel.price).toLocaleString('en-IN')}/night` : null,
    hotel.cancellation || null,
    hotel.payment || null,
    hotel.checkin_from ? `Check-in from ${hotel.checkin_from}${hotel.checkin_until ? ` until ${hotel.checkin_until}` : ''}` : null,
    hotel.checkout_until ? `Checkout until ${hotel.checkout_until}` : null,
    hotel.distance_to_center_km != null ? `${Number(hotel.distance_to_center_km).toFixed(1)} km to center` : null,
    hotel.distance_to_airport_km != null ? `${Number(hotel.distance_to_airport_km).toFixed(1)} km to airport` : null,
    hotel.city ? `Area: ${hotel.city}` : null,
    hotel.address ? `Address: ${hotel.address}` : null,
    hotel.location_rating ? `Location rating ${Number(hotel.location_rating).toFixed(1)}/5` : null,
    Array.isArray(hotel.nearby_places) && hotel.nearby_places.length ? `Nearby: ${hotel.nearby_places.join(', ')}` : null
  ];

  return facts.filter(Boolean);
}

function toHotelListItem(hotel) {
  return {
    id: hotel.id,
    name: hotel.name,
    price: hotel.price,
    rating: hotel.rating,
    currency: hotel.currency || 'INR',
    category: hotel.category || inferCategory(hotel.price),
    hotel_class: hotel.hotel_class || null,
    distance_to_center_km: hotel.distance_to_center_km ?? null,
    distance_to_airport_km: hotel.distance_to_airport_km ?? null,
    cancellation: hotel.cancellation || null,
    payment: hotel.payment || null,
    source: hotel.source || (hotel.simulated ? 'simulated' : 'api'),
    simulated: !!hotel.simulated,
    image: hotel.image || null,
    images: Array.isArray(hotel.images) ? hotel.images : []
  };
}

function toHotelDetailsItem(hotel, destination) {
  return {
    id: hotel.id,
    name: hotel.name,
    category: hotel.category || inferCategory(hotel.price),
    price: hotel.price,
    currency: hotel.currency || 'INR',
    rating: hotel.rating,
    summary: buildHotelSummary(hotel, destination),
    facts: buildHotelFacts(hotel),
    source: hotel.source || (hotel.simulated ? 'simulated' : 'api'),
    simulated: !!hotel.simulated,
    image: hotel.image || null,
    images: Array.isArray(hotel.images) ? hotel.images : []
  };
}

async function loadHotels({ destination, checkin, checkout, adults, hotelType }) {
  const checkIn = checkin || new Date().toISOString().slice(0, 10);
  const checkOut = checkout || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let hotels = await fetchHotelsRealTime(destination, checkIn, checkOut, adults);

  if (!hotels || hotels.length === 0) {
    hotels = buildSimulatedHotels({ destination, checkIn, checkOut, adults, hotelType });
  } else {
    hotels = hotels.map((hotel, index) => attachHotelGallery({
      ...hotel,
      id: hotel.id || `rt-${index + 1}`,
      category: hotel.category || inferCategory(hotel.price),
      simulated: false
    })).sort((a, b) => (a.price || 0) - (b.price || 0));
  }

  return {
    hotels,
    checkIn,
    checkOut
  };
}

router.get('/details', async (req, res) => {
  const destination = req.query.destination || req.query.city || '';
  const checkin = req.query.checkin || req.query.check_in || '';
  const checkout = req.query.checkout || req.query.check_out || '';
  const adults = parseInt(req.query.adults, 10) || 1;
  const hotelType = req.query.hotel_type || req.query.type || '';
  const hotelId = String(req.query.id || '').trim();

  if (!destination || !hotelId) {
    return res.status(400).json({ error: 'Destination and hotel id are required' });
  }

  const { hotels } = await loadHotels({ destination, checkin, checkout, adults, hotelType });
  const hotel = hotels.find((item) => String(item.id || '') === hotelId);
  if (!hotel) {
    return res.status(404).json({ error: 'Hotel not found for the current search' });
  }

  res.json({ hotel: toHotelDetailsItem(hotel, destination) });
});

router.get('/', async (req, res) => {
  const destination = req.query.destination || req.query.city || '';
  const checkin = req.query.checkin || req.query.check_in || '';
  const checkout = req.query.checkout || req.query.check_out || '';
  const adults = parseInt(req.query.adults, 10) || 1;
  const hotelType = req.query.hotel_type || req.query.type || '';
  if (!destination) {
    return res.json({ hotels: [], message: 'Provide destination' });
  }
  const { hotels, checkIn, checkOut } = await loadHotels({ destination, checkin, checkout, adults, hotelType });
  res.json({
    hotels: hotels.map(toHotelListItem),
    destination,
    checkIn,
    checkOut,
    adults,
    hotel_type: hotelType || null
  });
});

module.exports = router;
