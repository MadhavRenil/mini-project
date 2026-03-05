const express = require('express');
const { fetchHotelsRealTime, getHotelOption, HOTEL_TYPES } = require('../lib/apis');

const router = express.Router();

router.get('/', async (req, res) => {
  const destination = req.query.destination || req.query.city || '';
  const checkin = req.query.checkin || req.query.check_in || '';
  const checkout = req.query.checkout || req.query.check_out || '';
  const adults = parseInt(req.query.adults, 10) || 1;
  if (!destination) {
    return res.json({ hotels: [], message: 'Provide destination' });
  }
  const checkIn = checkin || new Date().toISOString().slice(0, 10);
  const checkOut = checkout || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let hotels = await fetchHotelsRealTime(destination, checkIn, checkOut, adults);
  if (!hotels || hotels.length === 0) {
    // Generate ~25 simulated "real-time" hotels
    hotels = [];
    const baseNames = ['Grand', 'Plaza', 'View', 'Stay', 'Inn', 'Resort', 'Suites', 'Palace', 'Lodge', 'Hostel'];
    const suffixes = ['Hotel', 'Residency', 'Homes', 'Villas', 'Retreat', 'Comforts'];
    for (let i = 0; i < 25; i++) {
      const name = baseNames[Math.floor(Math.random() * baseNames.length)] + ' ' + suffixes[Math.floor(Math.random() * suffixes.length)] + ' ' + (i + 1);
      const price = 800 + Math.floor(Math.random() * 15000);
      const rating = (6 + Math.random() * 4).toFixed(1);
      hotels.push({
        name: name,
        price: price,
        rating: rating,
        currency: 'INR',
        simulated: true
      });
    }
    hotels.sort((a, b) => a.price - b.price);
  } else {
    hotels = hotels.map(h => ({ ...h, simulated: false }));
  }
  res.json({ hotels, destination, checkIn, checkOut });
});

module.exports = router;
