# AI-Assisted Multimodal Travel Planner

Web-based intelligent platform to plan end-to-end travel using multiple transportation modes (flights, trains, buses, road). Uses AI-style recommendations, travel history, and local event data.

## Flow (step-by-step wizard)

1. **Step 1 - Where & when**: Source, Destination, Travel date, Number of travelers
2. **Step 2 - How to travel**: User chooses Flight / Train / Bus / Car (one or more)
3. **Step 3 - Where to stay**: Budget hotel, Mid-range, Luxury, Hostel, or Apartment; number of nights
4. **Step 4 - Style & budget**: Trip style (Adventure/Luxury/Family/Solo), Budget (INR)
5. **Backend** -> Fetches real-time Google Flights results via SerpApi when `SERPAPI_KEY` is set, merges with engine options, adds hotel cost, AI scoring
6. **Results** -> Transport + hotel options; "Live price" badge when SerpApi flight data is used
7. **User review** -> Select & review -> Dummy payment -> Booking confirmation -> Data stored for learning

## Real-time APIs (Google Maps, SerpApi, Hotels, Fuel)

- Set `SERPAPI_KEY` in your environment to enable live Google Flights, hotels, and event search.
- Example: `set SERPAPI_KEY=your_key` (Windows) or `export SERPAPI_KEY=your_key` (Mac/Linux), then `npm start`.
- Without the SerpApi key, the app falls back to simulated flight pricing and still works.
- `Google Maps`: Set `GOOGLE_MAPS_API_KEY` for the route map and Google city suggestions.
- `Hotels`: Real-time hotel list uses SerpApi first, then `RAPIDAPI_KEY` as a fallback provider if configured.
- `Fuel (Car)`: When user chooses Car, real-time petrol price (India) and fuel cost use same `RAPIDAPI_KEY`; subscribe to a fuel price API on RapidAPI.

## Features

- **User authentication**: Register and log in with email/password
- **Plan inputs**: Source, Destination, Travel date, Budget, Preferences (Adventure/Luxury/Family/Solo), Number of travelers
- **Multimodal route planning**: Flights, trains, buses, car; AI-ranked by preference and budget
- **Cost, distance, duration**: Per leg and total (x travelers)
- **Personalized recommendations**: Preference type + saved preferences + travel history
- **Event-based planning**: Local events at destination
- **Interactive map**: Google Maps
- **Review -> Dummy payment -> Booking confirmation**: Full booking flow; data stored for learning
- **Travel history & Preferences**: My Trips, preferred modes and budget

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript (vanilla), Google Maps for maps
- **Backend**: Node.js, Express
- **Database**: JSON file store (no native build), stored in `data/travel.json`
- **Session**: express-session (in-memory; use a store for production)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server (creates DB and tables automatically):
   ```bash
   npm start
   ```

3. Open in browser: [http://localhost:3000](http://localhost:3000)

## Usage

- **Plan Trip**: Enter Source, Destination, Travel date, Budget (optional), Preferences (Adventure/Luxury/Family/Solo), Number of travelers -> get AI-ranked options -> Select & review -> Dummy payment -> Booking confirmed; data saved.
- **Guests**: Can complete full flow; booking is stored (user_id null). Log in to link bookings and use My Trips.
- **My Trips**: View saved travel history (logged-in users).
- **Preferences**: Set preferred modes and budget for better recommendations.

## PHP API

To call the backend from PHP (e.g. another PHP frontend), use the proxy in `api/index.php`. Start the Node server first, then from PHP:

```php
$url = 'http://yourserver/api/index.php?path=travel/plan';
$data = json_encode(['source' => 'New York', 'destination' => 'Los Angeles', 'travel_date' => '2025-06-01', 'budget' => 500, 'preference_type' => 'adventure', 'num_travelers' => 2]);
$ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $data]]);
$response = file_get_contents($url, false, $ctx);
```

User data (users, travel_history, bookings) is stored in `data/travel.json` and is read/written by the Node backend.

## Project Structure

```text
├── server.js           # Express app entry
├── lib/
│   ├── db.js           # SQLite init and getDb
│   ├── auth.js         # requireAuth, optionalAuth
│   └── travelEngine.js # Multimodal route generation, recommendations
├── routes/
│   ├── auth.js         # register, login, logout, me
│   ├── travel.js       # plan, save-itinerary
│   ├── history.js      # list, delete
│   ├── preferences.js  # get, put
│   └── events.js       # events by city
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── data/               # travel.json (users, travel_history, bookings)
├── api/index.php       # PHP proxy to Node backend (optional)
└── scripts/init-db.js  # Optional: init DB only
```

## API Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register (email, password, name) |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Current user |
| POST | /api/travel/plan | Plan trip (source, destination, travel_date, budget, preference_type, num_travelers) |
| POST | /api/travel/save-itinerary | Save itinerary (auth) |
| POST | /api/travel/payment | Dummy payment (card details; returns payment_ref) |
| POST | /api/travel/confirm-booking | Confirm booking; store for future learning |
| GET | /api/history | Travel history (auth) |
| GET | /api/preferences | Get preferences (auth) |
| PUT | /api/preferences | Update preferences (auth) |
| GET | /api/events?city=... | Events at destination |

## Notes

- Route data is simulated for demo; production would integrate real transport/geocoding APIs.
- Events are sample data per city; production would use Eventbrite/Ticketmaster or similar.
- For production: use HTTPS, secure session store, and environment variables for secrets.
