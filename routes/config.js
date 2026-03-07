const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

router.get('/', (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    rapidApiKey: process.env.RAPIDAPI_KEY ? 'Has Key' : null,
    serpApiKey: process.env.SERPAPI_KEY ? 'Has Key' : null
  });
});

router.post('/', (req, res) => {
  const { rapidApiKey, googleMapsApiKey, serpApiKey } = req.body;

  if (rapidApiKey || googleMapsApiKey || serpApiKey) {
    if (rapidApiKey) process.env.RAPIDAPI_KEY = rapidApiKey;
    if (googleMapsApiKey) process.env.GOOGLE_MAPS_API_KEY = googleMapsApiKey;
    if (serpApiKey) process.env.SERPAPI_KEY = serpApiKey;

    // Persist to .env
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = '';

    try {
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }

      const newValues = {
        'RAPIDAPI_KEY': rapidApiKey,
        'GOOGLE_MAPS_API_KEY': googleMapsApiKey,
        'SERPAPI_KEY': serpApiKey
      };

      for (const [key, val] of Object.entries(newValues)) {
        if (!val) continue;
        const regex = new RegExp(`${key}=.*`, 'g');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${val}`);
        } else {
          envContent = envContent.trim() + `\n${key}=${val}\n`;
        }
      }

      fs.writeFileSync(envPath, envContent.trim() + '\n');
    } catch (err) {
      console.error('Failed to write .env file:', err);
    }
  }
  res.json({ success: true });
});

module.exports = router;
