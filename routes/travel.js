const express = require('express');
const { getDb } = require('../lib/db');
const { requireAuth, optionalAuth } = require('../lib/auth');
const {
  fullPipeline,
  fullPipelineWithSteps,
  generateMultimodalOptions
} = require('../lib/travelEngine');
const { getTransportOptions, getHotelOption } = require('../lib/apis');
const { generateItinerary } = require('../lib/itinerary');

const router = express.Router();

// Step-by-step: transport choice, hotel type → Fetch APIs (Skyscanner) → AI → Route optimization → Itinerary + hotel cost
router.post('/plan', optionalAuth(), async (req, res) => {
  const {
    source,
    destination,
    travel_date,
    start_date,
    end_date,
    budget,
    preference_type,
    num_travelers,
    transport_choice,
    hotel_type,
    hotel_nights,
    hotel_adults,
    selected_hotel
  } = req.body;
  if (!source || !destination) {
    return res.status(400).json({ error: 'Source and destination required' });
  }
  const userId = req.session && req.session.userId;
  const prefs = req.body.preferences || {};
  if (budget != null) prefs.budget_max = budget;
  const numT = Math.max(1, parseInt(num_travelers, 10) || 1);
  const travelDate = travel_date || start_date || null;

  let apiFlights = null;
  let flightDataSource = null;
  try {
    const transport = await getTransportOptions(source, destination, travelDate, numT, transport_choice);
    if (transport.hasLiveFlightData && transport.flightOptions && transport.flightOptions.length) {
      apiFlights = transport.flightOptions;
      flightDataSource = transport.flightSource || null;
    }
  } catch (_) { }

  const options = fullPipelineWithSteps(
    source,
    destination,
    travelDate,
    budget,
    preference_type,
    numT,
    transport_choice,
    hotel_type || 'midrange',
    hotel_nights || 2,
    selected_hotel || null,
    apiFlights,
    userId,
    prefs
  );

  const payload = {
    source,
    destination,
    travel_date: travelDate,
    end_date: end_date || null,
    budget: budget != null ? Number(budget) : null,
    preference_type: preference_type || null,
    num_travelers: numT,
    transport_choice: transport_choice || null,
    hotel_type: hotel_type || 'midrange',
    hotel_nights: hotel_nights || 2,
    hotel_adults: hotel_adults || numT,
    selected_hotel: selected_hotel || null,
    options,
    real_time_prices: !!apiFlights,
    flight_data_source: flightDataSource,
    generated_at: new Date().toISOString()
  };
  res.json(payload);
});

router.post('/save-itinerary', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const {
    source,
    destination,
    start_date,
    end_date,
    selected_option,
    total_distance_km,
    total_duration_minutes,
    estimated_cost,
    itinerary_json
  } = req.body;
  if (!source || !destination) {
    return res.status(400).json({ error: 'Source and destination required' });
  }
  const db = getDb();
  const start = start_date || new Date().toISOString().slice(0, 10);
  const modes = (selected_option && selected_option.modes)
    ? JSON.stringify(selected_option.modes)
    : '[]';
  const stmt = db.prepare(`
    INSERT INTO travel_history
    (user_id, source, destination, start_date, end_date, modes, distance_km, duration_minutes, estimated_cost, itinerary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    userId,
    source,
    destination,
    start,
    end_date || null,
    modes,
    total_distance_km || null,
    total_duration_minutes || null,
    estimated_cost || null,
    itinerary_json ? JSON.stringify(itinerary_json) : null
  );
  res.status(201).json({ success: true, message: 'Itinerary saved' });
});

// Generate Itinerary
router.post('/itinerary', optionalAuth(), async (req, res) => {
  const { destination, days, interests, context, selected_events } = req.body;
  if (!destination) {
    return res.status(400).json({ error: 'Destination required' });
  }

  try {
    // Basic context string construction
    let contextStr = context || '';
    if (req.session && req.session.userId) {
      contextStr += ' User is logged in.';
    }
    if (Array.isArray(selected_events) && selected_events.length) {
      const selectedEventNames = selected_events
        .map((event) => event?.name || event?.title)
        .filter(Boolean)
        .join(', ');
      if (selectedEventNames) {
        contextStr += ` Selected local events: ${selectedEventNames}.`;
      }
    }

    const itinerary = await generateItinerary(
      destination,
      days || 3,
      interests || [],
      contextStr,
      selected_events || []
    );
    res.json({ itinerary });
  } catch (err) {
    console.error('Itinerary route error:', err.message);
    res.status(500).json({ error: 'Failed to generate itinerary' });
  }
});

// Dummy payment — no real charge, returns success for demo
router.post('/payment', (req, res) => {
  const { card_number, expiry, cvv, name_on_card } = req.body;
  if (!card_number || !expiry || !name_on_card) {
    return res.status(400).json({ error: 'Card number, expiry, and name required' });
  }
  const paymentRef = 'DEMO-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  res.json({
    success: true,
    message: 'Payment accepted (demo)',
    payment_ref: paymentRef
  });
});

// Booking confirmation — store data for future learning
router.post('/confirm-booking', optionalAuth(), (req, res) => {
  const {
    source,
    destination,
    travel_date,
    budget,
    preference_type,
    num_travelers,
    selected_option,
    selected_events,
    itinerary,
    total_cost,
    payment_ref
  } = req.body;
  if (!source || !destination || !selected_option) {
    return res.status(400).json({ error: 'Source, destination, and selected option required' });
  }
  const userId = req.session && req.session.userId;
  const db = getDb();
  const storedSelection = typeof selected_option === 'string'
    ? { selected_option_raw: selected_option }
    : { ...selected_option };
  storedSelection.selected_events = Array.isArray(selected_events) ? selected_events : [];
  storedSelection.final_itinerary = Array.isArray(itinerary) ? itinerary : null;
  const optionJson = JSON.stringify(storedSelection);
  const cost = total_cost != null ? Number(total_cost) : (selected_option.total_cost != null ? selected_option.total_cost : 0);
  const stmt = db.prepare(`
    INSERT INTO bookings
    (user_id, source, destination, travel_date, budget, preference_type, num_travelers, selected_option_json, total_cost, payment_ref, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    userId || null,
    source,
    destination,
    travel_date || null,
    budget != null ? Number(budget) : null,
    preference_type || null,
    Math.max(1, parseInt(num_travelers, 10) || 1),
    optionJson,
    cost,
    payment_ref || null,
    'confirmed'
  );
  res.status(201).json({
    success: true,
    booking_id: result.lastInsertRowid,
    message: 'Booking confirmed. Data stored for future learning.'
  });
});

module.exports = router;
