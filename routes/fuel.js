const express = require('express');
const { fetchFuelPriceRealTime } = require('../lib/apis');

const router = express.Router();

router.get('/', async (req, res) => {
  const country = req.query.country || 'IN';
  let prices = await fetchFuelPriceRealTime(country);
  if (!prices) {
    prices = { petrol: 105, diesel: 95, currency: 'INR', simulated: true };
  } else {
    prices.currency = 'INR';
  }
  res.json(prices);
});

module.exports = router;
