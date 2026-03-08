# RouteX - AI-Assisted Multimodal Travel Planner

RouteX is a Node.js and Express travel planner that builds end-to-end trips across flights, trains, buses, and car travel. It combines live provider data when API keys are configured, deterministic fallback data when they are not, and optional AI-generated itineraries for the final trip plan.

## Main Flow

1. Choose source, destination, and travel dates.
2. Pick one or more transport modes.
3. Select a hotel type and number of nights.
4. Set trip style and budget.
5. Review ranked options, complete demo payment, and confirm the booking.

## Features

- Session-based user registration and login
- Multimodal trip planning with ranked transport and stay options
- Live flight, hotel, event, and autocomplete lookups when `SERPAPI_KEY` is configured
- RapidAPI-backed hotel and fuel integrations when `RAPIDAPI_KEY` is configured
- Google Maps frontend support when `GOOGLE_MAPS_API_KEY` is configured
- AI itinerary generation using OpenAI first, Gemini second, then local fallback templates
- Saved bookings, travel history, and user preferences stored in `data/travel.json`
- Demo-safe payment flow with booking confirmation persistence

## Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js, Express, express-session
- Data store: file-backed JSON store in `data/travel.json`
- AI providers: OpenAI and Gemini (optional)

## Environment

Copy `.env.example` to `.env` and set whichever keys you need.

- `PORT`: Optional. Defaults to `3003`.
- `SESSION_SECRET`: Optional. Falls back to a development-only value.
- `SERPAPI_KEY`: Enables live Google Flights, hotels, events, and location autocomplete.
- `RAPIDAPI_KEY`: Enables RapidAPI hotel and India fuel providers.
- `HOTEL_API_HOST`: Optional RapidAPI hotel host override.
- `GOOGLE_MAPS_API_KEY`: Enables Google Maps UI features.
- `OPENAI_API_KEY`: Primary AI provider for itinerary generation.
- `GEMINI_API_KEY`: Fallback AI provider for itinerary generation.

Without API keys, the planner still works by falling back to simulated or local data.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example` if you want live integrations or AI features.
3. Start the server:
   ```bash
   npm start
   ```
4. Open [http://localhost:3003](http://localhost:3003).

By default, the root URL serves the login page. The authenticated app is available at `/app`, and the registration page is `/register`.

## Usage

- Guests can plan trips, review options, and complete the demo booking flow.
- Logged-in users can save history, keep preferences, and view past bookings in My Trips.
- Car routes can include fuel estimates.
- Event selections can be merged into generated itineraries.

## API Overview

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/auth/register` | Register a new user and start a session |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | Get the current session user |
| POST | `/api/travel/plan` | Build ranked travel options |
| POST | `/api/travel/itinerary` | Generate an itinerary for a destination |
| POST | `/api/travel/save-itinerary` | Save an itinerary for the logged-in user |
| POST | `/api/travel/payment` | Demo payment endpoint |
| POST | `/api/travel/confirm-booking` | Confirm a booking and store it |
| GET | `/api/history` | List saved trips and bookings for the logged-in user |
| DELETE | `/api/history/:id` | Delete a saved history item |
| GET | `/api/preferences` | Get saved preferences for the logged-in user |
| PUT | `/api/preferences` | Update saved preferences |
| GET | `/api/events?city=...` | Get destination events |
| GET | `/api/events/all` | Get fallback events for sample cities |
| GET | `/api/hotels` | Get hotel options for a destination |
| GET | `/api/fuel` | Get fuel pricing, defaulting to India fallback values |
| GET | `/api/maps` | Health-style endpoint for map features |
| GET | `/api/maps/autocomplete?q=...` | Get location suggestions |
| GET | `/api/config` | Read configured frontend API key availability |
| POST | `/api/config` | Persist API keys into `.env` |

## Project Structure

```text
.
|-- server.js              # Express app entrypoint and route wiring
|-- lib/
|   |-- apis.js            # Live provider calls and fallback data builders
|   |-- auth.js            # Auth middleware
|   |-- db.js              # File-backed JSON store
|   |-- itinerary.js       # OpenAI/Gemini/static itinerary generation
|   `-- travelEngine.js    # Multimodal option generation and scoring
|-- routes/
|   |-- auth.js
|   |-- config.js
|   |-- events.js
|   |-- fuel.js
|   |-- history.js
|   |-- hotels.js
|   |-- maps.js
|   |-- preferences.js
|   `-- travel.js
|-- public/
|   |-- login.html
|   |-- register.html
|   |-- index.html
|   `-- mini-planner.html
|-- data/
|   `-- travel.json        # Users, preferences, history, bookings
|-- api/
|   `-- index.php          # Optional PHP proxy to the Node backend
|-- scripts/
|   `-- init-db.js         # Initializes the JSON store file
```

## PHP Proxy

`api/index.php` can proxy requests to the Node backend. It is configured for the local default backend URL `http://127.0.0.1:3003`.

Example:

```php
$url = 'http://yourserver/api/index.php?path=travel/plan';
$data = json_encode([
  'source' => 'New York',
  'destination' => 'Los Angeles',
  'travel_date' => '2026-06-01',
  'budget' => 500,
  'preference_type' => 'adventure',
  'num_travelers' => 2
]);
$ctx = stream_context_create([
  'http' => [
    'method' => 'POST',
    'header' => 'Content-Type: application/json',
    'content' => $data
  ]
]);
$response = file_get_contents($url, false, $ctx);
```

## Notes

- The app listens on port `3003` by default unless `PORT` is overridden.
- Travel, booking, and preference data is stored in `data/travel.json`, not SQLite.
- Sessions are stored in memory; use a persistent store and secure cookies before production deployment.
- External integrations are optional; the app remains usable without them.
