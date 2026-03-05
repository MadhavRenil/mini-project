// Database is auto-initialized on server start (lib/db.js initDb).
// Run: npm start
const { initDb } = require('../lib/db');
initDb();
console.log('Database initialized at data/travel.json');
