/**
 * Real-time travel APIs: Skyscanner (RapidAPI) for flights.
 * Set RAPIDAPI_KEY in env to enable. Falls back to engine when no key or API error.
 */

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const SKYSCANNER_HOST = 'skyscanner-skyscanner-flight-search-v1.p.rapidapi.com';

// IATA codes for common cities (for Skyscanner)
const CITY_TO_IATA = {
  'new york': 'NYCA', 'nyc': 'NYCA', 'new york city': 'NYCA',
  'los angeles': 'LAXA', 'la': 'LAXA', 'lax': 'LAXA',
  'chicago': 'CHIA', 'miami': 'MIA', 'boston': 'BOSA',
  'san francisco': 'SFO', 'sf': 'SFO', 'las vegas': 'LASA',
  'london': 'LONA', 'paris': 'PARA', 'delhi': 'DELA', 'mumbai': 'BOMA',
  'bangalore': 'BLRA', 'chennai': 'MAAA', 'hyderabad': 'HYDA'
};

function normalizePlace(name) {
  return (name || '').toLowerCase().trim();
}

function getIata(name) {
  const key = normalizePlace(name);
  return CITY_TO_IATA[key] || null;
}

/**
 * Fetch flight quotes from Skyscanner (RapidAPI Browse Quotes).
 * Returns array of { price, carrier, duration_minutes, outbound, quote_id } or null.
 */
async function fetchSkyscannerFlights(origin, destination, outboundDate, adults = 1) {
  if (!RAPIDAPI_KEY) return null;
  const originPlace = getIata(origin) || 'NYCA';
  const destPlace = getIata(destination) || 'LAXA';
  const date = (outboundDate || '').slice(0, 10).replace(/-/g, '-');
  const url = `https://${SKYSCANNER_HOST}/apiservices/browsequotes/v1.0/IN/INR/en-IN/${originPlace}/${destPlace}/${date}`;
  try {
    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Host': SKYSCANNER_HOST,
        'X-RapidAPI-Key': RAPIDAPI_KEY
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const quotes = data.Quotes || [];
    const carriers = (data.Carriers || []).reduce((acc, c) => { acc[c.CarrierId] = c.Name; return acc; }, {});
    const places = (data.Places || []).reduce((acc, p) => { acc[p.PlaceId] = p; return acc; }, {});
    return quotes.slice(0, 50).map(q => ({
      price: q.MinPrice || 0,
      carrier: carriers[q.OutboundLeg?.CarrierIds?.[0]] || 'Flight',
      duration_minutes: 0,
      outbound: q.OutboundLeg?.DepartureDate,
      quote_id: q.QuoteId,
      direct: q.Direct || false
    }));
  } catch (e) {
    return null;
  }
}

// Amadeus API (Client Credentials Flow)
const AMADEUS_CLIENT_ID = process.env.AMADEUS_CLIENT_ID;
const AMADEUS_CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET;
let amadeusToken = null;
let amadeusTokenExpiry = 0;

async function getAmadeusToken() {
  if (amadeusToken && Date.now() < amadeusTokenExpiry) return amadeusToken;
  if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) return null;

  try {
    const res = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${AMADEUS_CLIENT_ID}&client_secret=${AMADEUS_CLIENT_SECRET}`
    });
    if (!res.ok) return null;
    const data = await res.json();
    amadeusToken = data.access_token;
    amadeusTokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Buffer 1 min
    return amadeusToken;
  } catch (e) {
    console.error('Amadeus Token Error:', e.message);
    return null;
  }
}

async function fetchAmadeusFlights(origin, destination, departureDate, adults = 1) {
  const token = await getAmadeusToken();
  if (!token) return null; // Fallback to simulation

  try {
    const url = `https://test.api.amadeus.com/v2/shopping/flight-offers?originLocationCode=${origin}&destinationLocationCode=${destination}&departureDate=${departureDate}&adults=${adults}&max=10`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();

    return (data.data || []).map(offer => {
      const seg = offer.itineraries?.[0]?.segments?.[0];
      return {
        price: parseFloat(offer.price?.total) || 0,
        currency: offer.price?.currency || 'EUR',
        carrier: seg?.carrierCode || 'Amadeus', // Ideally map code to name
        duration_minutes: parseDuration(offer.itineraries?.[0]?.duration),
        outbound: seg?.departure?.at,
        quote_id: offer.id,
        direct: (offer.itineraries?.[0]?.segments?.length || 1) === 1
      };
    });
  } catch (e) {
    console.error('Amadeus Flight Error:', e.message);
    return null;
  }
}

function parseDuration(ptString) {
  if (!ptString) return 120;
  // PT2H30M format
  const match = ptString.match(/PT(\d+H)?(\d+M)?/);
  if (!match) return 120;
  const h = parseInt(match[1], 10) || 0;
  const m = parseInt(match[2], 10) || 0;
  return h * 60 + m;
}

/**
 * Get transport options: try Skyscanner/Amadeus/Engine.
 */
async function getTransportOptions(source, destination, travelDate, numTravelers, transportChoice) {
  const choices = Array.isArray(transportChoice) ? transportChoice : (transportChoice ? [transportChoice] : []);
  const wantFlight = choices.length === 0 || choices.includes('flight');
  let flightOptions = null;

  if (wantFlight) {
    // 1. Try Amadeus first if keys exist
    const iataSrc = getIata(source);
    const iataDst = getIata(destination);
    if (iataSrc && iataDst && travelDate) {
      flightOptions = await fetchAmadeusFlights(iataSrc, iataDst, travelDate, numTravelers);
    }

    // 2. Try Skyscanner if Amadeus failed/skipped
    if (!flightOptions) {
      flightOptions = await fetchSkyscannerFlights(source, destination, travelDate, numTravelers);
    }

    // 3. Fallback: Simulation
    if (!flightOptions || flightOptions.length === 0) {
      flightOptions = generateSimulatedFlights(source, destination, numTravelers);
    }
  }
  return { flightOptions, choices };
}



function generateSimulatedFlights(source, destination, numTravelers) {
  const airlines = ['Air India', 'Indigo', 'Vistara', 'SpiceJet', 'Emirates', 'Lufthansa', 'British Airways', 'Qatar Airways', 'Singapore Airlines', 'United'];
  const basePrice = 3000 + Math.random() * 5000;
  const flights = [];
  for (let i = 0; i < 25; i++) {
    const carrier = airlines[Math.floor(Math.random() * airlines.length)];
    const price = Math.round(basePrice * (0.8 + Math.random() * 1.5));
    flights.push({
      price: price,
      carrier: carrier,
      duration_minutes: 120 + Math.floor(Math.random() * 300),
      outbound: new Date().toISOString(), // sophisticated app would use travelDate
      quote_id: 'sim-' + i,
      direct: Math.random() > 0.3
    });
  }
  return flights.sort((a, b) => a.price - b.price);
}

const HOTEL_TYPES = {
  budget: { name: 'Budget hotel', pricePerNight: 1500 },
  midrange: { name: 'Mid-range hotel', pricePerNight: 4000 },
  luxury: { name: 'Luxury hotel', pricePerNight: 12000 },
  hostel: { name: 'Hostel', pricePerNight: 600 },
  apartment: { name: 'Apartment', pricePerNight: 3500 }
};

function getHotelOption(hotelType, nights = 1) {
  const h = HOTEL_TYPES[hotelType] || HOTEL_TYPES.midrange;
  const total = Math.round(h.pricePerNight * nights);
  return { type: hotelType, name: h.name, price_per_night: h.pricePerNight, total_nights: nights, total_cost: total };
}

const BOOKING_HOST = process.env.HOTEL_API_HOST || 'booking-com13.p.rapidapi.com';

async function fetchHotelsRealTime(destination, checkIn, checkOut, adults = 1) {
  if (!RAPIDAPI_KEY) return null;
  try {
    const locUrl = `https://${BOOKING_HOST}/v1/hotels/locations?name=${encodeURIComponent(destination)}`;
    const locRes = await fetch(locUrl, {
      headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': BOOKING_HOST }
    });
    if (!locRes.ok) return null;
    const locData = await locRes.json();
    const locations = Array.isArray(locData) ? locData : (locData.data || locData.destinations || []);
    const first = locations[0];
    const destId = first?.dest_id || (first?.dest_type ? first.dest_type + '|' + (first?.city_name || destination) : null);
    if (!destId) return null;
    const searchUrl = `https://${BOOKING_HOST}/v1/hotels/search?destination_id=${encodeURIComponent(destId)}&checkin=${checkIn || ''}&checkout=${checkOut || ''}&adults=${adults}`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': BOOKING_HOST }
    });
    if (!searchRes.ok) return null;
    const data = await searchRes.json();
    const properties = data.properties || data.results || [];
    return properties.slice(0, 50).map((p, i) => {
      const price = Number(p.price || p.priceBreakdown?.total?.value || p.recommendedPrice?.value || 0) || 0;
      const rating = Number(p.reviewScore || p.property?.reviewScore || 0) || null;
      const distanceCenter = Number(
        p.distance_to_cc
        || p.distanceToCityCenter
        || p.property?.distanceToCenter
        || p.property?.distance_to_city_center
      ) || null;
      const distanceAirport = Number(
        p.distanceToAirport
        || p.property?.distanceToAirport
        || p.distance_to_airport
      ) || null;
      const cancellation = p.isFreeCancellable
        ? 'Free cancellation'
        : (p.cancellation || p.cancellationType || p.policy || null);
      const payment = p.pay_at_property
        ? 'Pay at property'
        : (p.paymentType || p.payment?.type || null);
      return {
        id: p.hotel_id || p.id || p.property?.id || `rt-${i}`,
        name: p.name || p.property?.name || 'Hotel',
        price,
        rating,
        currency: p.currency || 'INR',
        distance_to_center_km: distanceCenter,
        distance_to_airport_km: distanceAirport,
        cancellation: cancellation || null,
        payment: payment || null
      };
    });
  } catch (e) {
    return null;
  }
}

const FUEL_HOST = 'daily-petrol-diesel-lpg-cng-fuel-prices-in-india.p.rapidapi.com';

async function fetchFuelPriceRealTime(country = 'IN') {
  if (!RAPIDAPI_KEY) return null;
  try {
    const url = `https://${FUEL_HOST}/v1/prices?state=delhi`;
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': FUEL_HOST }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const petrol = data?.petrol ?? data?.data?.[0]?.petrol ?? data?.price ?? null;
    const diesel = data?.diesel ?? data?.data?.[0]?.diesel ?? null;
    if (petrol != null || diesel != null) return { petrol: petrol || diesel || 0, diesel: diesel || petrol || 0 };
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  fetchSkyscannerFlights,
  fetchAmadeusFlights,
  getTransportOptions,
  getHotelOption,
  fetchHotelsRealTime,
  fetchFuelPriceRealTime,
  HOTEL_TYPES,
  getIata,
  RAPIDAPI_KEY
};

