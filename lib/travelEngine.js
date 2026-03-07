/**
 * Multimodal travel engine: generates routes with flights, trains, buses, road.
 * Uses simulated data for demonstration; can be wired to real APIs (e.g. Amadeus, Rome2Rio).
 */

const MODES = {
  flight: { name: 'Flight', speedKmh: 800, costPerKm: 0.15, co2Factor: 0.2 },
  train: { name: 'Train', speedKmh: 120, costPerKm: 0.08, co2Factor: 0.05 },
  bus: { name: 'Bus', speedKmh: 70, costPerKm: 0.05, co2Factor: 0.08 },
  car: { name: 'Car', speedKmh: 90, costPerKm: 0.12, co2Factor: 0.15 }
};

// Approximate distances between major cities (simplified; real app would use geocoding + routing API)
const CITY_DISTANCES = {
  'new york': { 'los angeles': 3944, 'chicago': 1147, 'miami': 1742, 'boston': 306 },
  'los angeles': { 'new york': 3944, 'san francisco': 559, 'las vegas': 432 },
  'chicago': { 'new york': 1147, 'los angeles': 2808, 'miami': 1892 },
  'miami': { 'new york': 1742, 'chicago': 1892 },
  'boston': { 'new york': 306 },
  'san francisco': { 'los angeles': 559 },
  'las vegas': { 'los angeles': 432 }
};

function normalizeCity(name) {
  return (name || '').toLowerCase().trim();
}

function getDistance(source, destination) {
  const s = normalizeCity(source);
  const d = normalizeCity(destination);
  if (s === d) return 0;
  const fromMap = CITY_DISTANCES[s];
  if (fromMap && fromMap[d] !== undefined) return fromMap[d];
  const toMap = CITY_DISTANCES[d];
  if (toMap && toMap[s] !== undefined) return toMap[s];
  // Fallback: use a heuristic based on string length + random for demo
  const base = 200 + (s.length + d.length) * 80;
  return Math.round(base + Math.random() * 400);
}

function generateLeg(mode, distanceKm) {
  const m = MODES[mode] || MODES.car;
  const durationMin = Math.round((distanceKm / m.speedKmh) * 60);
  const cost = Math.round(distanceKm * m.costPerKm * (0.9 + Math.random() * 0.2) * 100) / 100;
  return {
    mode,
    modeName: m.name,
    distance_km: Math.round(distanceKm * 10) / 10,
    duration_minutes: durationMin,
    estimated_cost: cost
  };
}

function generateMultimodalOptions(source, destination) {
  const totalKm = getDistance(source, destination);
  const options = [];

  // Option 1: Single mode (flight for long, train/bus for short)
  if (totalKm > 500) {
    options.push({
      id: 'flight-direct',
      legs: [generateLeg('flight', totalKm)],
      total_distance_km: totalKm,
      total_duration_minutes: Math.round((totalKm / MODES.flight.speedKmh) * 60) + 90,
      total_cost: 0,
      modes: ['flight']
    });
  }
  options.push({
    id: 'train-direct',
    legs: [generateLeg('train', totalKm)],
    total_distance_km: totalKm,
    total_duration_minutes: Math.round((totalKm / MODES.train.speedKmh) * 60),
    total_cost: 0,
    modes: ['train']
  });
  options.push({
    id: 'bus-direct',
    legs: [generateLeg('bus', totalKm)],
    total_distance_km: totalKm,
    total_duration_minutes: Math.round((totalKm / MODES.bus.speedKmh) * 60),
    total_cost: 0,
    modes: ['bus']
  });
  options.push({
    id: 'car-direct',
    legs: [generateLeg('car', totalKm)],
    total_distance_km: totalKm,
    total_duration_minutes: Math.round((totalKm / MODES.car.speedKmh) * 60),
    total_cost: 0,
    modes: ['car']
  });

  // Multimodal: flight + car/train for last mile
  if (totalKm > 800) {
    const flightKm = totalKm * 0.85;
    const groundKm = totalKm - flightKm;
    const leg1 = generateLeg('flight', flightKm);
    const leg2 = generateLeg('car', groundKm);
    const duration = leg1.duration_minutes + 60 + leg2.duration_minutes;
    const cost = leg1.estimated_cost + leg2.estimated_cost;
    options.push({
      id: 'flight-car',
      legs: [leg1, leg2],
      total_distance_km: totalKm,
      total_duration_minutes: duration,
      total_cost: cost,
      modes: ['flight', 'car']
    });
  }

  options.forEach(opt => {
    if (opt.total_cost === 0) {
      opt.total_cost = opt.legs.reduce((s, l) => s + l.estimated_cost, 0);
    }
    if (!opt.total_duration_minutes) {
      opt.total_duration_minutes = opt.legs.reduce((s, l) => s + l.duration_minutes, 0);
    }
  });

  return options.sort((a, b) => a.total_cost - b.total_cost);
}

// Preference types: Adventure, Luxury, Family, Solo — used for AI scoring
const PREFERENCE_SCORES = {
  adventure: { flight: 0.8, train: 0.6, bus: 0.7, car: 1 },
  luxury: { flight: 1, train: 0.9, bus: 0.4, car: 0.8 },
  family: { flight: 0.7, train: 0.9, bus: 0.8, car: 0.7 },
  solo: { flight: 0.9, train: 0.8, bus: 0.8, car: 0.9 }
};

function applyPreferenceScoring(options, preferenceType, budget, numTravelers) {
  const pref = (preferenceType || '').toLowerCase();
  const scores = PREFERENCE_SCORES[pref] || {};
  const num = Math.max(1, parseInt(numTravelers, 10) || 1);

  return options.map(opt => {
    const baseCost = opt.total_cost != null ? opt.total_cost : opt.legs.reduce((s, l) => s + (l.estimated_cost || 0), 0);
    const totalCost = Math.round(baseCost * num * 100) / 100;
    let aiScore = 100;
    (opt.modes || []).forEach(m => {
      aiScore += (scores[m] || 0.5) * 15;
    });
    if (budget != null && totalCost <= budget) aiScore += 20;
    return { ...opt, total_cost: totalCost, score: aiScore, num_travelers: num };
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
}

function getRecommendations(userId, preferences, history, options) {
  const db = require('./db').getDb();
  let prefs = { preferred_modes: [], budget_max: Infinity };
  if (userId) {
    const row = db.prepare('SELECT preferred_modes, budget_max FROM user_preferences WHERE user_id = ?').get(userId);
    if (row) {
      try {
        prefs.preferred_modes = JSON.parse(row.preferred_modes || '[]');
        if (row.budget_max != null) prefs.budget_max = row.budget_max;
      } catch (_) { }
    }
  }
  if (preferences && preferences.preferred_modes) prefs.preferred_modes = preferences.preferred_modes;
  if (preferences && preferences.budget_max != null) prefs.budget_max = preferences.budget_max;

  const scored = options.map(opt => {
    let score = 100;
    const modes = opt.modes || [];
    if (prefs.preferred_modes.length) {
      const match = modes.some(m => prefs.preferred_modes.includes(m));
      if (match) score += 20;
    }
    if (opt.total_cost <= prefs.budget_max) score += 10;
    if (opt.total_duration_minutes < 300) score += 5;
    return { ...opt, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 50);
}

function fullPipeline(source, destination, travelDate, budget, preferenceType, numTravelers, userId, preferences) {
  const options = generateMultimodalOptions(source, destination);
  const withTravelers = applyPreferenceScoring(options, preferenceType, budget, numTravelers);
  const recommendations = getRecommendations(userId, preferences, null, withTravelers);
  return recommendations.slice(0, 5);
}

/** Filter options by user's transport choice (flight/train/bus/car). */
function filterByTransportChoice(options, transportChoice) {
  if (!transportChoice || !Array.isArray(transportChoice) || transportChoice.length === 0) return options;
  return options.filter(opt => (opt.modes || []).some(m => transportChoice.includes(m)));
}

/** Merge real-time flight API results into options. API results have { price, carrier, duration_minutes }. */
function mergeApiFlights(engineOptions, apiFlights, numTravelers, routeDistanceKm = null) {
  if (!apiFlights || apiFlights.length === 0) return engineOptions;
  const num = Math.max(1, numTravelers || 1);
  const fallbackDistance = routeDistanceKm != null ? routeDistanceKm : 0;
  const flightOptions = apiFlights.slice(0, 50).map((f, i) => ({
    id: 'flight-api-' + i,
    legs: [{
      mode: 'flight',
      modeName: f.carrier || 'Flight',
      estimated_cost: f.price,
      duration_minutes: f.duration_minutes || 120,
      distance_km: fallbackDistance
    }],
    total_cost: (f.price || 0) * num,
    total_duration_minutes: f.duration_minutes || 120,
    total_distance_km: fallbackDistance,
    modes: ['flight'],
    from_api: f.provider !== 'simulated',
    provider: f.provider || null,
    carrier: f.carrier || null,
    outbound: f.outbound || null,
    quote_id: f.quote_id || null,
    direct: f.direct !== false
  }));
  const withoutFlight = engineOptions.filter(o => !(o.modes || []).includes('flight'));
  return [...flightOptions, ...withoutFlight].sort((a, b) => (a.total_cost || 0) - (b.total_cost || 0));
}

/** Add hotel cost to each option. hotelType: budget, midrange, luxury, hostel, apartment. nights default 2. */
function addHotelToOptions(options, hotelType, nights = 2, selectedHotel = null) {
  const { getHotelOption } = require('./apis');
  let hotel = getHotelOption(hotelType, nights);
  if (selectedHotel && selectedHotel.price_per_night != null) {
    const n = Math.max(1, parseInt(nights, 10) || 1);
    const nightly = Math.max(0, Number(selectedHotel.price_per_night) || 0);
    hotel = {
      id: selectedHotel.id || null,
      type: selectedHotel.type || hotelType || 'midrange',
      name: selectedHotel.name || hotel.name,
      price_per_night: nightly,
      total_nights: n,
      total_cost: Math.round(nightly * n),
      rating: selectedHotel.rating != null ? Number(selectedHotel.rating) : null,
      simulated: !!selectedHotel.simulated,
      source: selectedHotel.source || null,
      distance_to_center_km: selectedHotel.distance_to_center_km != null ? Number(selectedHotel.distance_to_center_km) : null,
      distance_to_airport_km: selectedHotel.distance_to_airport_km != null ? Number(selectedHotel.distance_to_airport_km) : null,
      cancellation: selectedHotel.cancellation || null,
      payment: selectedHotel.payment || null
    };
  }
  return options.map(opt => ({
    ...opt,
    hotel: hotel,
    total_cost: (opt.total_cost || 0) + hotel.total_cost,
    total_with_hotel: (opt.total_cost || 0) + hotel.total_cost
  }));
}

function fullPipelineWithSteps(source, destination, travelDate, budget, preferenceType, numTravelers, transportChoice, hotelType, hotelNights, selectedHotel, apiFlightOptions, userId, preferences) {
  let options = generateMultimodalOptions(source, destination);
  const routeDistanceKm = getDistance(source, destination);
  options = mergeApiFlights(options, apiFlightOptions, numTravelers, routeDistanceKm);
  if (transportChoice && transportChoice.length) options = filterByTransportChoice(options, transportChoice);
  const withTravelers = applyPreferenceScoring(options, preferenceType, budget, numTravelers);
  options = addHotelToOptions(withTravelers, hotelType || 'midrange', hotelNights || 2, selectedHotel || null);
  const recommendations = getRecommendations(userId, preferences, null, options);
  return recommendations.slice(0, 50);
}

module.exports = {
  generateMultimodalOptions,
  getRecommendations,
  getDistance,
  applyPreferenceScoring,
  fullPipeline,
  fullPipelineWithSteps,
  filterByTransportChoice,
  mergeApiFlights,
  addHotelToOptions,
  MODES
};
