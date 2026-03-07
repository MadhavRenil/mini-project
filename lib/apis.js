/**
 * Real-time travel integrations.
 * Flights: SerpApi Google Flights, then simulation.
 * Hotels: SerpApi first, then Booking.com RapidAPI.
 * Events: SerpApi Google Events.
 * Fuel: RapidAPI fuel price endpoint, falls back to simulation when unavailable.
 */

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SERPAPI_BASE_URL = 'https://serpapi.com/search';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const BOOKING_HOST = process.env.HOTEL_API_HOST || 'booking-com15.p.rapidapi.com';
const FUEL_HOST = 'daily-petrol-diesel-lpg-cng-fuel-prices-in-india.p.rapidapi.com';

const CITY_TO_IATA_CODE = {
  'new york': 'NYC',
  'nyc': 'NYC',
  'new york city': 'NYC',
  'los angeles': 'LAX',
  'la': 'LAX',
  'lax': 'LAX',
  'chicago': 'CHI',
  'miami': 'MIA',
  'boston': 'BOS',
  'san francisco': 'SFO',
  'sf': 'SFO',
  'las vegas': 'LAS',
  'london': 'LON',
  'paris': 'PAR',
  'delhi': 'DEL',
  'new delhi': 'DEL',
  'mumbai': 'BOM',
  'bangalore': 'BLR',
  'bengaluru': 'BLR',
  'chennai': 'MAA',
  'hyderabad': 'HYD',
  'kolkata': 'CCU',
  'goa': 'GOI',
  'pune': 'PNQ',
  'ahmedabad': 'AMD',
  'jaipur': 'JAI',
  'singapore': 'SIN',
  'dubai': 'DXB'
};

const HOTEL_TYPES = {
  budget: { name: 'Budget hotel', pricePerNight: 1500 },
  midrange: { name: 'Mid-range hotel', pricePerNight: 4000 },
  luxury: { name: 'Luxury hotel', pricePerNight: 12000 },
  hostel: { name: 'Hostel', pricePerNight: 600 },
  apartment: { name: 'Apartment', pricePerNight: 3500 }
};

function normalizePlace(name) {
  return (name || '').toLowerCase().trim();
}

function getLocationVariants(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];

  const variants = [
    raw,
    raw.split(',')[0]?.trim(),
    raw.split('(')[0]?.trim()
  ].filter(Boolean);

  return [...new Set(variants.map((variant) => normalizePlace(variant)).filter(Boolean))];
}

function getIata(name) {
  const variants = getLocationVariants(name);
  for (const variant of variants) {
    if (CITY_TO_IATA_CODE[variant]) return CITY_TO_IATA_CODE[variant];
  }
  return null;
}

function resolveAirportCode(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();

  const embeddedMatch = raw.match(/\(([A-Za-z]{3})\)/);
  if (embeddedMatch?.[1]) return embeddedMatch[1].toUpperCase();

  return getIata(raw);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  return { ok: res.ok, status: res.status, text, data };
}

function buildSerpApiUrl(params = {}) {
  const url = new URL(SERPAPI_BASE_URL);
  const finalParams = {
    hl: 'en',
    gl: 'in',
    ...params,
    api_key: SERPAPI_KEY
  };

  Object.entries(finalParams).forEach(([key, value]) => {
    if (value == null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

async function fetchSerpApi(params = {}) {
  if (!SERPAPI_KEY) return null;

  try {
    const result = await fetchJson(buildSerpApiUrl(params));
    if (!result.ok) return null;
    return result.data || null;
  } catch (_) {
    return null;
  }
}

async function fetchSerpApiFlightAutocomplete(query) {
  const q = String(query || '').trim();
  if (!q || !SERPAPI_KEY) return [];

  const data = await fetchSerpApi({
    engine: 'google_flights_autocomplete',
    q,
    exclude_regions: 'true'
  });

  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
  return suggestions.map((suggestion) => ({
    name: suggestion.name || '',
    type: suggestion.type || '',
    description: suggestion.description || '',
    id: suggestion.id || null,
    airports: Array.isArray(suggestion.airports) ? suggestion.airports : []
  }));
}

function pickFlightLocationId(suggestion) {
  if (!suggestion) return null;
  return suggestion.id
    || suggestion.airports?.[0]?.city_id
    || suggestion.airports?.[0]?.id
    || null;
}

async function resolveFlightLocationId(location, preferredId = null) {
  if (preferredId) return String(preferredId).trim();

  const raw = String(location || '').trim();
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();

  const embeddedMatch = raw.match(/\(([A-Za-z]{3})\)/);
  if (embeddedMatch?.[1]) return embeddedMatch[1].toUpperCase();

  const variants = getLocationVariants(location);
  for (const variant of variants) {
    const suggestions = await fetchSerpApiFlightAutocomplete(variant);
    if (!suggestions.length) continue;

    const exact = suggestions.find((suggestion) => {
      const suggestionName = normalizePlace(suggestion.name);
      const airportCity = normalizePlace(suggestion.airports?.[0]?.city || '');
      return suggestionName.startsWith(variant) || airportCity === variant;
    }) || suggestions[0];

    const locationId = pickFlightLocationId(exact);
    if (locationId) return locationId;
  }

  return getIata(raw);
}

function extractTimeLabel(text, fallback = null) {
  const match = String(text || '').match(/\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm))\b/);
  return match ? match[1].toUpperCase().replace(/\s+/g, ' ') : fallback;
}

function parseMinutesFromDurationLabel(text) {
  if (!text) return null;
  const hours = String(text).match(/(\d+)\s*hr/i);
  const minutes = String(text).match(/(\d+)\s*min/i);
  const total = (hours ? parseInt(hours[1], 10) * 60 : 0) + (minutes ? parseInt(minutes[1], 10) : 0);
  return total || null;
}

function parseHotelClassValue(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function formatDateForSearch(dateText) {
  if (!dateText) return '';
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(dateText);
  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

async function fetchSerpApiFlights({
  origin,
  destination,
  outboundDate,
  returnDate = null,
  adults = 1,
  departureId = null,
  arrivalId = null
}) {
  if (!SERPAPI_KEY || !outboundDate) return null;

  const [resolvedDepartureId, resolvedArrivalId] = await Promise.all([
    resolveFlightLocationId(origin, departureId),
    resolveFlightLocationId(destination, arrivalId)
  ]);

  if (!resolvedDepartureId || !resolvedArrivalId) return null;

  const data = await fetchSerpApi({
    engine: 'google_flights',
    type: returnDate ? '1' : '2',
    departure_id: resolvedDepartureId,
    arrival_id: resolvedArrivalId,
    outbound_date: outboundDate,
    return_date: returnDate,
    adults: Math.max(1, adults || 1),
    currency: 'INR'
  });

  const flights = [
    ...(Array.isArray(data?.best_flights) ? data.best_flights : []),
    ...(Array.isArray(data?.other_flights) ? data.other_flights : [])
  ];

  if (!flights.length) return null;

  return flights.slice(0, 50).map((option, index) => {
    const segments = Array.isArray(option.flights) ? option.flights : [];
    const first = segments[0] || {};
    const last = segments[segments.length - 1] || first;
    const firstAirline = first.airline || first.airline_logo || 'Flight';
    const stopCount = Array.isArray(option.layovers)
      ? option.layovers.length
      : Math.max(0, segments.length - 1);

    return {
      price: Number(option.price) || 0,
      price_total: Number(option.price) || 0,
      currency: 'INR',
      carrier: firstAirline,
      duration_minutes: Number(option.total_duration) || parseMinutesFromDurationLabel(option.duration) || 120,
      outbound: first?.departure_airport?.time || null,
      arrival: last?.arrival_airport?.time || null,
      quote_id: option.booking_token || `serpapi-flight-${index + 1}`,
      direct: stopCount === 0,
      stop_count: stopCount,
      booking_token: option.booking_token || null,
      departure_token: option.departure_token || null,
      airline_logo: option.airline_logo || first?.airline_logo || null,
      trip_type: returnDate ? 'roundtrip' : 'oneway',
      return_date: returnDate || null,
      route_label: option.type || (returnDate ? 'Round trip' : 'One way'),
      provider: 'serpapi'
    };
  }).sort((a, b) => (a.price || 0) - (b.price || 0));
}

async function getTransportOptions(source, destination, travelDate, numTravelers, transportChoice, options = {}) {
  const choices = Array.isArray(transportChoice) ? transportChoice : (transportChoice ? [transportChoice] : []);
  const wantFlight = choices.length === 0 || choices.includes('flight');
  let flightOptions = null;
  let flightSource = null;

  if (wantFlight) {
    flightOptions = await fetchSerpApiFlights({
      origin: source,
      destination,
      outboundDate: travelDate,
      returnDate: options.returnDate || null,
      adults: numTravelers,
      departureId: options.departureId || null,
      arrivalId: options.arrivalId || null
    });
    if (flightOptions && flightOptions.length) flightSource = 'serpapi';
  }

  return {
    flightOptions: flightOptions && flightOptions.length ? flightOptions : null,
    choices,
    flightSource,
    hasLiveFlightData: Boolean(flightOptions && flightOptions.length && flightSource)
  };
}

function generateSimulatedFlights(source, destination, numTravelers) {
  const airlines = ['Air India', 'Indigo', 'Vistara', 'SpiceJet', 'Emirates', 'Lufthansa', 'British Airways', 'Qatar Airways', 'Singapore Airlines', 'United'];
  const basePrice = 3000 + Math.random() * 5000;
  const flights = [];

  for (let i = 0; i < 25; i++) {
    const carrier = airlines[Math.floor(Math.random() * airlines.length)];
    const price = Math.round(basePrice * (0.8 + Math.random() * 1.5));
    flights.push({
      price,
      carrier,
      duration_minutes: 120 + Math.floor(Math.random() * 300),
      outbound: new Date().toISOString(),
      quote_id: 'sim-' + i,
      direct: Math.random() > 0.3,
      provider: 'simulated'
    });
  }

  return flights.sort((a, b) => a.price - b.price);
}

function getHotelOption(hotelType, nights = 1) {
  const hotel = HOTEL_TYPES[hotelType] || HOTEL_TYPES.midrange;
  const total = Math.round(hotel.pricePerNight * nights);
  return {
    type: hotelType,
    name: hotel.name,
    price_per_night: hotel.pricePerNight,
    total_nights: nights,
    total_cost: total
  };
}

function parseDistance(text, pattern) {
  const match = (text || '').match(pattern);
  return match ? Number(match[1]) : null;
}

function inferBookingSearchType(location) {
  const raw = String(
    location?.search_type
    || location?.searchType
    || location?.dest_type
    || location?.type
    || 'CITY'
  ).trim().toLowerCase();

  const map = {
    city: 'CITY',
    district: 'DISTRICT',
    hotel: 'HOTEL',
    landmark: 'LANDMARK',
    airport: 'AIRPORT',
    ci: 'CITY',
    di: 'DISTRICT',
    ht: 'HOTEL',
    lm: 'LANDMARK',
    ap: 'AIRPORT'
  };

  return map[raw] || raw.toUpperCase();
}

async function fetchSerpApiHotels(destination, checkIn, checkOut, adults = 1) {
  if (!SERPAPI_KEY || !destination || !checkIn || !checkOut) return null;

  const data = await fetchSerpApi({
    engine: 'google_hotels',
    q: destination,
    check_in_date: checkIn,
    check_out_date: checkOut,
    adults: Math.max(1, adults || 1),
    currency: 'INR'
  });

  const properties = Array.isArray(data?.properties) ? data.properties : [];
  if (!properties.length) return null;

  const stays = properties.slice(0, 50).map((hotel, index) => {
    const hotelClass = parseHotelClassValue(hotel.extracted_hotel_class ?? hotel.hotel_class);
    const overallRating = Number(hotel.overall_rating);
    const nightlyPrice = Number(
      hotel?.rate_per_night?.extracted_lowest
      ?? hotel?.prices?.[0]?.extracted_price
      ?? 0
    ) || 0;

    return {
      id: hotel.property_token || `serpapi-hotel-${index + 1}`,
      name: hotel.name || 'Hotel',
      price: nightlyPrice,
      rating: Number.isFinite(overallRating) ? Number((overallRating * 2).toFixed(1)) : null,
      currency: 'INR',
      hotel_class: hotelClass,
      image: hotel.images?.[0]?.thumbnail || null,
      cancellation: hotel.free_cancellation ? 'Free cancellation' : null,
      payment: hotel.extracted_price ? 'Pay now' : null,
      source: 'serpapi'
    };
  }).filter((hotel) => hotel.price > 0);

  return stays.length ? stays.sort((a, b) => (a.price || 0) - (b.price || 0)) : null;
}

async function fetchHotelsRealTime(destination, checkIn, checkOut, adults = 1) {
  const serpHotels = await fetchSerpApiHotels(destination, checkIn, checkOut, adults);
  if (serpHotels && serpHotels.length) return serpHotels;
  if (!RAPIDAPI_KEY) return null;

  try {
    const destinationUrl = `https://${BOOKING_HOST}/api/v1/hotels/searchDestination?query=${encodeURIComponent(destination)}`;
    const destinationResult = await fetchJson(destinationUrl, {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': BOOKING_HOST
      }
    });

    if (!destinationResult.ok) return null;

    const locations = Array.isArray(destinationResult.data?.data)
      ? destinationResult.data.data
      : Array.isArray(destinationResult.data)
        ? destinationResult.data
        : [];

    const first = locations[0];
    const destId = first?.dest_id || first?.destId || null;
    const searchType = inferBookingSearchType(first);
    if (!destId) return null;

    const searchUrl = new URL(`https://${BOOKING_HOST}/api/v1/hotels/searchHotels`);
    searchUrl.searchParams.set('dest_id', String(destId));
    searchUrl.searchParams.set('search_type', searchType);
    searchUrl.searchParams.set('arrival_date', checkIn || '');
    searchUrl.searchParams.set('departure_date', checkOut || '');
    searchUrl.searchParams.set('adults', String(Math.max(1, adults || 1)));
    searchUrl.searchParams.set('room_qty', '1');
    searchUrl.searchParams.set('page_number', '1');
    searchUrl.searchParams.set('units', 'metric');
    searchUrl.searchParams.set('temperature_unit', 'c');
    searchUrl.searchParams.set('languagecode', 'en-us');
    searchUrl.searchParams.set('currency_code', 'INR');

    const hotelsResult = await fetchJson(searchUrl.toString(), {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': BOOKING_HOST
      }
    });

    if (!hotelsResult.ok) return null;

    const hotels = Array.isArray(hotelsResult.data?.data?.hotels)
      ? hotelsResult.data.data.hotels
      : Array.isArray(hotelsResult.data?.hotels)
        ? hotelsResult.data.hotels
        : [];

    return hotels.slice(0, 50).map((hotel, index) => {
      const property = hotel.property || hotel;
      const label = hotel.accessibilityLabel || property.accessibilityLabel || '';
      const price = Number(
        property?.priceBreakdown?.grossPrice?.value
        || property?.priceBreakdown?.displayPrice?.value
        || hotel?.price
        || 0
      ) || 0;
      const rating = Number(property?.reviewScore || property?.review_score || 0) || null;
      const distanceToCenter = parseDistance(label, /([\d.]+)\s*km from downtown/i);
      const distanceToAirport = parseDistance(label, /([\d.]+)\s*km from airport/i);

      return {
        id: hotel.hotel_id || property.id || `rt-${index}`,
        name: property.name || hotel.name || 'Hotel',
        price,
        rating,
        currency: property.currency || property?.priceBreakdown?.grossPrice?.currency || 'INR',
        distance_to_center_km: distanceToCenter,
        distance_to_airport_km: distanceToAirport,
        cancellation: /free cancellation/i.test(label) ? 'Free cancellation' : null,
        payment: /no prepayment needed/i.test(label) ? 'No prepayment needed' : null,
        source: 'rapidapi'
      };
    });
  } catch (_) {
    return null;
  }
}

async function fetchEventsRealTime(destination, travelDate = null) {
  if (!SERPAPI_KEY || !destination) return null;

  const formattedDate = formatDateForSearch(travelDate);
  const queries = [];
  if (formattedDate) queries.push(`Events in ${destination} around ${formattedDate}`);
  queries.push(`Events in ${destination}`);

  let events = [];
  for (const query of queries) {
    const data = await fetchSerpApi({
      engine: 'google_events',
      q: query
    });
    events = Array.isArray(data?.events_results) ? data.events_results : [];
    if (events.length) break;
  }

  if (!events.length) return null;

  return events.slice(0, 20).map((event, index) => ({
    id: `serpapi-event-${index + 1}-${Buffer.from((event.title || `event-${index + 1}`)).toString('hex').slice(0, 12)}`,
    name: event.title || 'Local event',
    date: event?.date?.start_date || null,
    when: event?.date?.when || null,
    type: 'Local event',
    venue: event?.venue?.name || event?.address?.[0] || 'Venue TBA',
    address: Array.isArray(event.address) ? event.address.join(', ') : (event.address || null),
    description: event.description || null,
    link: event.link || event?.ticket_info?.[0]?.link || null,
    ticket_source: event?.ticket_info?.[0]?.source || null,
    ticket_type: event?.ticket_info?.[0]?.link_type || null,
    image: event.image || event.thumbnail || null,
    time_label: extractTimeLabel(event?.date?.when, null),
    source: 'serpapi'
  }));
}

async function fetchFuelPriceRealTime(country = 'IN') {
  if (!RAPIDAPI_KEY || String(country).toUpperCase() !== 'IN') return null;

  try {
    const url = `https://${FUEL_HOST}/v1/prices?state=delhi`;
    const result = await fetchJson(url, {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': FUEL_HOST
      }
    });

    if (!result.ok) return null;

    const data = result.data || {};
    const petrol = data?.petrol ?? data?.data?.[0]?.petrol ?? data?.price ?? null;
    const diesel = data?.diesel ?? data?.data?.[0]?.diesel ?? null;

    if (petrol != null || diesel != null) {
      return {
        petrol: petrol || diesel || 0,
        diesel: diesel || petrol || 0
      };
    }

    return null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  fetchSerpApiFlights,
  fetchSerpApiFlightAutocomplete,
  getTransportOptions,
  getHotelOption,
  fetchSerpApiHotels,
  fetchHotelsRealTime,
  fetchEventsRealTime,
  fetchFuelPriceRealTime,
  resolveFlightLocationId,
  HOTEL_TYPES,
  getIata,
  SERPAPI_KEY,
  RAPIDAPI_KEY
};
