/**
 * File-based JSON store compatible with prepare().run/get/all API
 * so routes can stay unchanged. No native build required.
 */
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (_) {
    // Serverless platforms such as Vercel expose a read-only app filesystem.
  }
}

const dbPath = path.join(dataDir, 'travel.json');
let persistenceEnabled = true;
let persistenceWarningShown = false;

function isReadOnlyFsError(error) {
  return Boolean(error) && ['EROFS', 'EPERM', 'EACCES'].includes(error.code);
}

function load() {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {
      users: [],
      travel_history: [],
      user_preferences: [],
      bookings: [],
      _seq: { users: 0, travel_history: 0, bookings: 0 }
    };
  }
}

function save(data) {
  if (!persistenceEnabled) return;

  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    if (isReadOnlyFsError(error)) {
      persistenceEnabled = false;
      if (!persistenceWarningShown) {
        persistenceWarningShown = true;
        console.warn('[db] persistence disabled; using in-memory store only');
      }
      return;
    }
    throw error;
  }
}

let cache = null;

function getData() {
  if (!cache) cache = load();
  return cache;
}

function persist() {
  if (cache) save(cache);
}

function getDb() {
  const data = getData();

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      run(...args) {
        if (s.startsWith('INSERT INTO users')) {
          const email = args[0], hash = args[1], name = args[2];
          if (data.users.some(u => u.email === email))
            throw { code: 'SQLITE_CONSTRAINT_UNIQUE' };
          const id = (data._seq.users = (data._seq.users || 0) + 1);
          data.users.push({
            id,
            email,
            password_hash: hash,
            name,
            role: 'user',
            created_at: new Date().toISOString()
          });
          persist();
          return { lastInsertRowid: id, changes: 1 };
        }
        if (s.startsWith('INSERT INTO travel_history')) {
          const [userId, source, destination, start_date, end_date, modes, distance_km, duration_minutes, estimated_cost, itinerary_json] = args;
          const id = (data._seq.travel_history = (data._seq.travel_history || 0) + 1);
          data.travel_history.push({
            id,
            user_id: userId,
            source,
            destination,
            start_date,
            end_date,
            modes,
            distance_km,
            duration_minutes,
            estimated_cost,
            itinerary_json,
            created_at: new Date().toISOString()
          });
          persist();
          return { lastInsertRowid: id, changes: 1 };
        }
        if (s.includes('user_preferences')) {
          const [userId, preferred_modes, budget_min, budget_max, interests, updated_at] = args;
          const idx = data.user_preferences.findIndex(p => p.user_id === userId);
          const row = { user_id: userId, preferred_modes, budget_min, budget_max, interests, updated_at };
          if (idx >= 0) data.user_preferences[idx] = row;
          else data.user_preferences.push(row);
          persist();
          return { changes: 1 };
        }
        if (s.startsWith('DELETE FROM travel_history')) {
          const id = Number(args[0]), userId = Number(args[1]);
          const idx = data.travel_history.findIndex(h => h.id === id && h.user_id === userId);
          if (idx < 0) return { changes: 0 };
          data.travel_history.splice(idx, 1);
          persist();
          return { changes: 1 };
        }
        if (s.startsWith('INSERT INTO bookings')) {
          const [userId, source, destination, travel_date, budget, preference_type, num_travelers, selected_option_json, total_cost, payment_ref, status] = args;
          const id = (data._seq.bookings = (data._seq.bookings || 0) + 1);
          data.bookings = data.bookings || [];
          data.bookings.push({
            id,
            user_id: userId,
            source,
            destination,
            travel_date: travel_date || null,
            budget: budget != null ? budget : null,
            preference_type: preference_type || null,
            num_travelers: num_travelers != null ? num_travelers : 1,
            selected_option_json: selected_option_json || null,
            total_cost: total_cost != null ? total_cost : null,
            payment_ref: payment_ref || null,
            status: status || 'confirmed',
            created_at: new Date().toISOString()
          });
          persist();
          return { lastInsertRowid: id, changes: 1 };
        }
        return { changes: 0 };
      },
      get(...args) {
        if (s.includes('FROM users WHERE email')) {
          const email = args[0];
          return data.users.find(u => u.email === email) || null;
        }
        if (s.includes('FROM users WHERE id')) {
          const id = args[0];
          return data.users.find(u => u.id === id) || null;
        }
        if (s.includes('FROM user_preferences WHERE user_id')) {
          const userId = args[0];
          return data.user_preferences.find(p => p.user_id === userId) || null;
        }
        if (s.includes('FROM bookings WHERE id')) {
          const id = Number(args[0]);
          return (data.bookings || []).find(b => b.id === id) || null;
        }
        return null;
      },
      all(...args) {
        if (s.includes('FROM travel_history') && s.includes('user_id')) {
          const userId = args[0];
          return data.travel_history
            .filter(h => h.user_id === userId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        if (s.includes('FROM bookings') && s.includes('user_id')) {
          const userId = args[0];
          return (data.bookings || [])
            .filter(b => b.user_id === userId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        return [];
      }
    };
  }

  return { prepare, getData, persist };
}

function initDb() {
  const data = getData();
  data.users = data.users || [];
  data.travel_history = data.travel_history || [];
  data.user_preferences = data.user_preferences || [];
  data.bookings = data.bookings || [];
  const maxUserId = data.users.length ? Math.max(...data.users.map(u => u.id)) : 0;
  const maxHistoryId = data.travel_history.length ? Math.max(...data.travel_history.map(h => h.id)) : 0;
  const maxBookingId = data.bookings.length ? Math.max(...data.bookings.map(b => b.id)) : 0;
  data._seq = data._seq || {};
  data._seq.users = Math.max(data._seq.users || 0, maxUserId);
  data._seq.travel_history = Math.max(data._seq.travel_history || 0, maxHistoryId);
  data._seq.bookings = Math.max(data._seq.bookings || 0, maxBookingId);
  persist();
  return getDb();
}

module.exports = { getDb, initDb };
