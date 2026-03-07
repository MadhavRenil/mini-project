const express = require('express');
const { fetchSerpApiFlightAutocomplete } = require('../lib/apis');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ ready: true, message: 'Maps and travel autocomplete endpoints ready.' });
});

router.get('/autocomplete', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.json({ suggestions: [] });
  }

  try {
    const suggestions = await fetchSerpApiFlightAutocomplete(q);
    const payload = suggestions.slice(0, 8).map((suggestion, index) => {
      const primaryAirport = suggestion.airports?.[0] || {};
      return {
        id: suggestion.id || primaryAirport.city_id || primaryAirport.id || `suggestion-${index + 1}`,
        label: suggestion.name || primaryAirport.city || primaryAirport.name || q,
        description: suggestion.description || '',
        type: suggestion.type || 'city',
        location_id: suggestion.id || primaryAirport.city_id || primaryAirport.id || null,
        airport_id: primaryAirport.id || null,
        city: primaryAirport.city || suggestion.name || '',
        airports: (suggestion.airports || []).slice(0, 3).map((airport) => ({
          id: airport.id || null,
          name: airport.name || '',
          city: airport.city || '',
          city_id: airport.city_id || null,
          distance: airport.distance || null
        }))
      };
    });

    return res.json({ suggestions: payload });
  } catch (err) {
    console.error('[maps-autocomplete]', err.message);
    return res.json({ suggestions: [] });
  }
});

module.exports = router;

