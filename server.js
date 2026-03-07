require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const authRoutes = require('./routes/auth');
const travelRoutes = require('./routes/travel');
const historyRoutes = require('./routes/history');
const preferencesRoutes = require('./routes/preferences');
const eventsRoutes = require('./routes/events');
const configRoutes = require('./routes/config');
const hotelsRoutes = require('./routes/hotels');
const fuelRoutes = require('./routes/fuel');
const mapsRoutes = require('./routes/maps');
const { initDb } = require('./lib/db');

initDb();

// Log unexpected failures so the process does not silently die without context.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ai-travel-planner-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use('/api/auth', authRoutes);
app.use('/api/travel', travelRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/hotels', hotelsRoutes);
app.use('/api/fuel', fuelRoutes);
app.use('/api/maps', mapsRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/app', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// SPA fallback: serve index.html for other non-API GET routes.
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central API error handler (prevents route exceptions from crashing the process).
app.use((err, req, res, next) => {
  console.error('[express-error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`AI Travel Planner running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  console.error('[server-error]', err.message);
});

module.exports = { app, server };


