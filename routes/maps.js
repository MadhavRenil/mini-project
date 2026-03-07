const express = require('express');

const router = express.Router();

// Placeholder route to keep server running when map service is not yet implemented.
router.get('/', (req, res) => {
  res.json({ ready: true, message: 'Maps endpoint placeholder' });
});

module.exports = router;

