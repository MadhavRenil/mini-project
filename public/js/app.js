(function () {
  const API = '/api';
  let googleMapsApiKey = '';
  let googleMapInstance = null;
  let googleMapsReady = false;
  let googleMapsLoadPromise = null;
  let googleMapsLoadResolve = null;
  let googleMapsLoadReject = null;
  let mapRenderToken = 0;
  let lastPlanData = null; // transport_choice, options for real-time sections
  let planState = null; // { source, destination, travel_date, budget, preference_type, num_travelers, selected_option }
  let flightRealtimeOptions = [];
  let hotelRealtimeOptions = [];
  let selectedHotel = null;
  let hotelFetchKey = '';
  let destinationEvents = [];
  let selectedDestinationEvents = [];
  let destinationEventsKey = '';
  let pendingReviewCard = null;
  const autocompleteCache = new Map();

  function scrollViewportTo(target, behavior = 'smooth') {
    const top = target
      ? Math.max(0, target.getBoundingClientRect().top + window.scrollY - 96)
      : 0;
    window.scrollTo({ top, behavior });
  }

  function showPage(pageId) {
    document.querySelectorAll('.page').forEach((p) => {
      const isActive = p.id === 'page-' + pageId;
      p.classList.toggle('active', isActive);
      p.hidden = !isActive;
    });
    const page = document.getElementById('page-' + pageId);
    if (page) {
      page.classList.add('active');
      page.hidden = false;
      scrollViewportTo(page);
    }
    if (pageId === 'plan') initPlanPage();
    if (pageId === 'history') loadHistory();
    if (pageId === 'preferences') loadPreferences();
    if (pageId === 'review' && planState) renderReviewSummary();
    if (pageId === 'confirmation' && planState) renderConfirmation();
  }

  function setAuthUI(user) {
    const navLogin = document.getElementById('navLogin');
    const btnLogout = document.getElementById('btnLogout');
    const userBadge = document.getElementById('userBadge');
    if (user) {
      if (navLogin) navLogin.style.display = 'none';
      if (btnLogout) { btnLogout.hidden = false; btnLogout.style.display = 'inline-block'; }
      if (userBadge) userBadge.textContent = user.email;
    } else {
      if (navLogin) navLogin.style.display = 'inline-block';
      if (btnLogout) btnLogout.hidden = true;
      if (userBadge) userBadge.textContent = '';
    }
  }

  async function fetchJSON(url, options = {}) {
    const res = await fetch(url, { ...options, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  // Lightweight toast notifications for UX (replaces blocking alert dialogs)
  function notify(message, type = 'info') {
    let wrap = document.getElementById('appToastWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'appToastWrap';
      wrap.className = 'app-toast-wrap';
      document.body.appendChild(wrap);
    }
    const toast = document.createElement('div');
    toast.className = `app-toast ${type}`;
    toast.textContent = message;
    wrap.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function setButtonLoading(btn, loadingText, isLoading) {
    if (!btn) return;
    if (isLoading) {
      if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
      btn.textContent = loadingText;
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.originalText || btn.textContent;
      btn.disabled = false;
    }
  }

  function redirectToLogin() {
    window.location.replace('/login');
  }

  function buildGoogleMapsRouteUrl(source, destination) {
    return 'https://www.google.com/maps/dir/?api=1&origin='
      + encodeURIComponent(source || '')
      + '&destination='
      + encodeURIComponent(destination || '')
      + '&travelmode=driving';
  }

  function renderGoogleMapsFallback(container, source, destination, message) {
    const iframeSrc = 'https://www.google.com/maps?q='
      + encodeURIComponent([source, destination].filter(Boolean).join(' to '))
      + '&output=embed';
    const routeUrl = buildGoogleMapsRouteUrl(source, destination);

    container.innerHTML = `
      <div class="map-embed-shell">
        <iframe
          title="Google Maps preview"
          src="${iframeSrc}"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          style="width:100%; height:100%; min-height:320px; border:0; border-radius:24px;"
        ></iframe>
        <div style="margin-top:0.75rem; color:var(--text-soft, #6b7280); font-size:0.95rem;">
          ${escapeHtml(message || 'Google Maps preview is shown in simplified mode.')}
        </div>
        <a
          href="${routeUrl}"
          target="_blank"
          rel="noopener noreferrer"
          style="display:inline-flex; margin-top:0.75rem; text-decoration:none;"
        >Open route in Google Maps</a>
      </div>
    `;
  }

  function handleGoogleMapsReady() {
    googleMapsReady = !!(window.google && window.google.maps);

    if (googleMapsLoadResolve) {
      googleMapsLoadResolve(true);
      googleMapsLoadResolve = null;
      googleMapsLoadReject = null;
    }

    const activeTrip = planState || lastPlanData;
    if (activeTrip?.source && activeTrip?.destination) {
      renderMap(activeTrip.source, activeTrip.destination);
    }
  }

  function loadGoogleMapsScript(apiKey) {
    if (!apiKey) return Promise.resolve(false);
    if (window.google && window.google.maps) {
      handleGoogleMapsReady();
      return Promise.resolve(true);
    }
    if (googleMapsLoadPromise) return googleMapsLoadPromise;

    googleMapsLoadPromise = new Promise((resolve, reject) => {
      googleMapsLoadResolve = resolve;
      googleMapsLoadReject = reject;

      const existingScript = document.querySelector('script[data-google-maps-loader="1"]');
      if (existingScript) {
        existingScript.addEventListener('load', handleGoogleMapsReady, { once: true });
        existingScript.addEventListener('error', () => {
          googleMapsReady = false;
          googleMapsLoadPromise = null;
          if (googleMapsLoadReject) {
            googleMapsLoadReject(new Error('Failed to load Google Maps'));
            googleMapsLoadResolve = null;
            googleMapsLoadReject = null;
          }
        }, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?key='
        + encodeURIComponent(apiKey)
        + '&libraries=places&callback=initGooglePlacesAutocomplete';
      script.async = true;
      script.defer = true;
      script.dataset.googleMapsLoader = '1';
      script.onerror = () => {
        googleMapsReady = false;
        googleMapsLoadPromise = null;
        script.remove();
        if (googleMapsLoadReject) {
          googleMapsLoadReject(new Error('Failed to load Google Maps'));
          googleMapsLoadResolve = null;
          googleMapsLoadReject = null;
        }
      };
      document.head.appendChild(script);
    });

    return googleMapsLoadPromise;
  }

  function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function parseDateTimeValue(value) {
    if (!value) return null;
    const normalized = String(value).trim().replace(' ', 'T');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatTimeLabel(value, fallbackDate = null) {
    const parsed = parseDateTimeValue(value);
    const source = parsed || fallbackDate;
    if (!source || Number.isNaN(source.getTime())) return '--:--';
    return `${String(source.getHours()).padStart(2, '0')}:${String(source.getMinutes()).padStart(2, '0')}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cloneEvents(events) {
    return (Array.isArray(events) ? events : []).map((event) => ({ ...event }));
  }

  function getSelectedEventsForPlan() {
    return cloneEvents(selectedDestinationEvents);
  }

  function syncPlanSelectedEvents() {
    if (!planState) return;
    planState.selected_events = getSelectedEventsForPlan();
  }

  function buildCheckoutDate(checkin, nights) {
    const n = Math.max(1, parseInt(nights, 10) || 1);
    const base = checkin ? new Date(checkin + 'T00:00:00') : new Date();
    const out = new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
    return out.toISOString().slice(0, 10);
  }

  function parseDateOnly(value) {
    if (!value) return null;
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function getTodayDateValue() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getTripMetrics(departureDate, returnDate) {
    if (!departureDate && !returnDate) return { state: 'empty', days: null, nights: null, label: 'Choose travel dates', invalid: false };
    if (!departureDate) return { state: 'invalid', days: null, nights: null, label: 'Add a departure date first', invalid: true };
    const today = parseDateOnly(getTodayDateValue());
    const start = parseDateOnly(departureDate);
    if (!start) return { state: 'invalid', days: null, nights: null, label: 'Check your travel dates', invalid: true };
    if (today && start.getTime() < today.getTime()) {
      return { state: 'invalid', days: null, nights: null, label: 'Departure date cannot be in the past', invalid: true };
    }
    if (!returnDate) return { state: 'oneway', days: null, nights: null, label: 'One-way trip', invalid: false };
    const end = parseDateOnly(returnDate);
    if (!start || !end) return { state: 'invalid', days: null, nights: null, label: 'Check your travel dates', invalid: true };
    const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
    if (diff < 0) return { state: 'invalid', days: null, nights: null, label: 'Return date must be after departure', invalid: true };
    const days = diff + 1;
    const nights = diff;
    return { state: 'roundtrip', days, nights, label: `${days} day${days === 1 ? '' : 's'} | ${nights} night${nights === 1 ? '' : 's'}`, invalid: false };
  }

  function getTripLengthLabel(days, nights) {
    if (!Number.isFinite(days) || days < 1) return '';
    const safeNights = Number.isFinite(nights) ? Math.max(0, nights) : Math.max(0, days - 1);
    return `${days} day${days === 1 ? '' : 's'} | ${safeNights} night${safeNights === 1 ? '' : 's'}`;
  }

  function getTripDateLine(departureDate, returnDate) {
    if (!departureDate) return 'Travel dates: TBD';
    if (!returnDate) return `Departure: ${departureDate} | One-way`;
    const metrics = getTripMetrics(departureDate, returnDate);
    if (metrics.invalid) return `Departure: ${departureDate} | Return: ${returnDate}`;
    return `Departure: ${departureDate} | Return: ${returnDate} | ${getTripLengthLabel(metrics.days, metrics.nights)}`;
  }

  function getTripValidationMessage(departureDate, returnDate) {
    if (!departureDate) return 'Please choose a departure date.';
    const metrics = getTripMetrics(departureDate, returnDate);
    if (metrics.label === 'Departure date cannot be in the past') return metrics.label;
    if (metrics.invalid) return 'Return date must be on or after the departure date.';
    return '';
  }

  const COUNTRY_ALIAS_MAP = Object.freeze({
    india: 'India',
    ind: 'India',
    usa: 'United States',
    us: 'United States',
    america: 'United States',
    'united states': 'United States',
    'united states of america': 'United States',
    uk: 'United Kingdom',
    britain: 'United Kingdom',
    england: 'United Kingdom',
    scotland: 'United Kingdom',
    wales: 'United Kingdom',
    'great britain': 'United Kingdom',
    'united kingdom': 'United Kingdom',
    uae: 'United Arab Emirates',
    'united arab emirates': 'United Arab Emirates',
    france: 'France',
    germany: 'Germany',
    italy: 'Italy',
    spain: 'Spain',
    portugal: 'Portugal',
    singapore: 'Singapore',
    japan: 'Japan',
    thailand: 'Thailand',
    malaysia: 'Malaysia',
    indonesia: 'Indonesia',
    vietnam: 'Vietnam',
    china: 'China',
    nepal: 'Nepal',
    'sri lanka': 'Sri Lanka',
    maldives: 'Maldives',
    australia: 'Australia',
    canada: 'Canada',
    ireland: 'Ireland',
    netherlands: 'Netherlands',
    switzerland: 'Switzerland',
    austria: 'Austria',
    belgium: 'Belgium',
    greece: 'Greece',
    turkey: 'Turkey',
    qatar: 'Qatar',
    oman: 'Oman',
    'saudi arabia': 'Saudi Arabia',
    'south korea': 'South Korea',
    korea: 'South Korea',
    'czech republic': 'Czech Republic'
  });

  const COUNTRY_CODE_MAP = Object.freeze({
    India: 'IN',
    'United States': 'US',
    'United Kingdom': 'GB',
    'United Arab Emirates': 'AE',
    France: 'FR',
    Germany: 'DE',
    Italy: 'IT',
    Spain: 'ES',
    Portugal: 'PT',
    Singapore: 'SG',
    Japan: 'JP',
    Thailand: 'TH',
    Malaysia: 'MY',
    Indonesia: 'ID',
    Vietnam: 'VN',
    China: 'CN',
    Nepal: 'NP',
    'Sri Lanka': 'LK',
    Maldives: 'MV',
    Australia: 'AU',
    Canada: 'CA',
    Ireland: 'IE',
    Netherlands: 'NL',
    Switzerland: 'CH',
    Austria: 'AT',
    Belgium: 'BE',
    Greece: 'GR',
    Turkey: 'TR',
    Qatar: 'QA',
    Oman: 'OM',
    'Saudi Arabia': 'SA',
    'South Korea': 'KR',
    'Czech Republic': 'CZ'
  });

  const CITY_COUNTRY_MAP = Object.freeze({
    delhi: 'India',
    'new delhi': 'India',
    mumbai: 'India',
    bangalore: 'India',
    bengaluru: 'India',
    chennai: 'India',
    hyderabad: 'India',
    kolkata: 'India',
    pune: 'India',
    ahmedabad: 'India',
    jaipur: 'India',
    goa: 'India',
    kochi: 'India',
    kochin: 'India',
    kathmandu: 'Nepal',
    colombo: 'Sri Lanka',
    male: 'Maldives',
    dubai: 'United Arab Emirates',
    'abu dhabi': 'United Arab Emirates',
    singapore: 'Singapore',
    london: 'United Kingdom',
    paris: 'France',
    berlin: 'Germany',
    munich: 'Germany',
    frankfurt: 'Germany',
    rome: 'Italy',
    milan: 'Italy',
    venice: 'Italy',
    madrid: 'Spain',
    barcelona: 'Spain',
    lisbon: 'Portugal',
    amsterdam: 'Netherlands',
    zurich: 'Switzerland',
    geneva: 'Switzerland',
    vienna: 'Austria',
    brussels: 'Belgium',
    athens: 'Greece',
    prague: 'Czech Republic',
    istanbul: 'Turkey',
    doha: 'Qatar',
    muscat: 'Oman',
    riyadh: 'Saudi Arabia',
    jeddah: 'Saudi Arabia',
    bangkok: 'Thailand',
    phuket: 'Thailand',
    tokyo: 'Japan',
    osaka: 'Japan',
    kyoto: 'Japan',
    'kuala lumpur': 'Malaysia',
    jakarta: 'Indonesia',
    bali: 'Indonesia',
    hanoi: 'Vietnam',
    'ho chi minh city': 'Vietnam',
    seoul: 'South Korea',
    sydney: 'Australia',
    melbourne: 'Australia',
    brisbane: 'Australia',
    toronto: 'Canada',
    vancouver: 'Canada',
    dublin: 'Ireland',
    'new york': 'United States',
    'los angeles': 'United States',
    chicago: 'United States',
    miami: 'United States',
    boston: 'United States',
    'san francisco': 'United States',
    'las vegas': 'United States',
    seattle: 'United States',
    washington: 'United States'
  });

  const COUNTRY_ALIASES_BY_LENGTH = Object.keys(COUNTRY_ALIAS_MAP).sort((left, right) => right.length - left.length);
  const CITY_NAMES_BY_LENGTH = Object.keys(CITY_COUNTRY_MAP).sort((left, right) => right.length - left.length);

  function normalizeLooseText(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeCountryName(value) {
    const normalized = normalizeLooseText(value);
    return COUNTRY_ALIAS_MAP[normalized] || null;
  }

  function inferCountryCode(countryName) {
    return countryName ? (COUNTRY_CODE_MAP[countryName] || '') : '';
  }

  function inferCountryFromLocation(label, description = '') {
    const parts = uniqueStrings([label, description]);
    for (const part of parts) {
      const directCountry = normalizeCountryName(part);
      if (directCountry) return directCountry;

      const segments = String(part)
        .split(/[|,\/()\-]/)
        .map((segment) => normalizeLooseText(segment))
        .filter(Boolean);

      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        const segmentCountry = normalizeCountryName(segment);
        if (segmentCountry) return segmentCountry;
        if (CITY_COUNTRY_MAP[segment]) return CITY_COUNTRY_MAP[segment];
      }
    }

    const combined = normalizeLooseText(parts.join(' '));
    if (!combined) return null;
    if (CITY_COUNTRY_MAP[combined]) return CITY_COUNTRY_MAP[combined];

    for (const cityName of CITY_NAMES_BY_LENGTH) {
      if (combined === cityName || combined.startsWith(cityName + ' ') || combined.includes(' ' + cityName + ' ')) {
        return CITY_COUNTRY_MAP[cityName];
      }
    }

    for (const alias of COUNTRY_ALIASES_BY_LENGTH) {
      if (combined === alias || combined.startsWith(alias + ' ') || combined.includes(' ' + alias + ' ')) {
        return COUNTRY_ALIAS_MAP[alias];
      }
    }

    return null;
  }

  function getInputCountry(inputEl) {
    if (!inputEl) return null;
    return normalizeCountryName(inputEl.dataset.country || '')
      || inferCountryFromLocation(inputEl.value || inputEl.dataset.selectedLabel || '', inputEl.dataset.locationDescription || '');
  }

  function clearInputLocationState(inputEl) {
    if (!inputEl) return;
    delete inputEl.dataset.locationId;
    delete inputEl.dataset.airportId;
    delete inputEl.dataset.placeId;
    delete inputEl.dataset.selectedLabel;
    delete inputEl.dataset.country;
    delete inputEl.dataset.countryCode;
    delete inputEl.dataset.locationDescription;
  }

  function applyInputLocationSuggestion(inputEl, suggestion, keepCurrentValue = false) {
    if (!inputEl || !suggestion) return;
    if (!keepCurrentValue && suggestion.label) inputEl.value = suggestion.label;
    const inferredCountry = normalizeCountryName(suggestion.country || '')
      || inferCountryFromLocation(suggestion.label || inputEl.value || '', suggestion.description || '');
    inputEl.dataset.locationId = suggestion.location_id || '';
    inputEl.dataset.airportId = suggestion.airport_id || '';
    inputEl.dataset.placeId = suggestion.place_id || '';
    inputEl.dataset.selectedLabel = suggestion.label || inputEl.value || '';
    inputEl.dataset.country = inferredCountry || '';
    inputEl.dataset.countryCode = suggestion.country_code || inferCountryCode(inferredCountry);
    inputEl.dataset.locationDescription = suggestion.description || '';
  }

  function copyInputLocationState(sourceInput, targetInput) {
    if (!sourceInput || !targetInput) return;
    targetInput.value = sourceInput.value || '';
    applyInputLocationSuggestion(targetInput, {
      label: sourceInput.value || '',
      location_id: sourceInput.dataset.locationId || '',
      airport_id: sourceInput.dataset.airportId || '',
      place_id: sourceInput.dataset.placeId || '',
      country: sourceInput.dataset.country || '',
      country_code: sourceInput.dataset.countryCode || '',
      description: sourceInput.dataset.locationDescription || ''
    }, true);
    if (!sourceInput.dataset.locationId && !sourceInput.dataset.airportId && !sourceInput.dataset.placeId && !sourceInput.dataset.country) clearInputLocationState(targetInput);
  }

  function getInputLocationId(inputEl) {
    if (!inputEl) return '';
    return inputEl.dataset.locationId || inputEl.dataset.airportId || '';
  }

  function buildTravelDocumentRequirement() {
    const sourceInput = document.getElementById('planSource');
    const destinationInput = document.getElementById('planDestination');
    const sourceLabel = sourceInput?.value?.trim() || '';
    const destinationLabel = destinationInput?.value?.trim() || '';
    if (!destinationLabel) return null;

    const sourceCountry = getInputCountry(sourceInput);
    const destinationCountry = getInputCountry(destinationInput);
    if (!sourceCountry && !destinationCountry) return null;

    if (sourceCountry && destinationCountry && sourceCountry === destinationCountry) {
      return {
        state: 'clear',
        badge: 'Visa status: Not required',
        title: 'Domestic trip inside ' + destinationCountry,
        summary: 'Your source and destination appear to be in ' + destinationCountry + ', so a visa is normally not needed for this trip.',
        checklist: [
          'Carry a valid government-issued photo ID for flights, hotel check-in, and station or airport entry.',
          'Check local permit or restricted-area rules if your itinerary includes special regions or protected zones.'
        ],
        disclaimer: 'Planning reminder only. Airlines, hotels, and local authorities can still ask for valid ID.'
      };
    }

    const inferredInternational = sourceCountry && destinationCountry
      ? sourceCountry !== destinationCountry
      : !!destinationCountry && destinationCountry !== 'India';

    if (!inferredInternational) return null;

    const destinationName = destinationCountry || destinationLabel;
    const originName = sourceCountry || sourceLabel || 'your departure country';

    return {
      state: 'check',
      badge: destinationCountry ? ('Visa status: Check ' + destinationCountry + ' entry rules') : 'Visa status: Check official entry rules',
      title: 'International trip: ' + destinationName,
      summary: 'This trip appears to cross borders from ' + originName + ' to ' + destinationName + '. Visa, eVisa, ETA, or other entry approval depends on your passport, trip purpose, and length of stay.',
      checklist: [
        'Check the official embassy, consulate, or immigration site for ' + destinationName + ' before booking non-refundable travel.',
        'Confirm whether you need a visa, eVisa, ETA, or visa-on-arrival, and apply only through an official government portal or approved visa center.',
        'Prepare the documents commonly requested: passport validity, photo, flight and hotel bookings, proof of funds, and travel insurance if required.'
      ],
      disclaimer: 'This planner gives a preliminary travel-documents reminder only. Entry rules change and depend on nationality.'
    };
  }

  function renderTravelRequirementsNotice() {
    const card = document.getElementById('travelDocCard');
    const badge = document.getElementById('travelDocBadge');
    const title = document.getElementById('travelDocTitle');
    const summary = document.getElementById('travelDocSummary');
    const checklist = document.getElementById('travelDocChecklist');
    const disclaimer = document.getElementById('travelDocDisclaimer');
    if (!card || !badge || !title || !summary || !checklist || !disclaimer) return;

    const requirement = buildTravelDocumentRequirement();
    if (!requirement) {
      card.classList.add('hidden');
      card.setAttribute('hidden', 'hidden');
      checklist.innerHTML = '';
      summary.textContent = '';
      disclaimer.textContent = '';
      return;
    }

    badge.textContent = requirement.badge;
    badge.dataset.state = requirement.state;
    title.textContent = requirement.title;
    summary.textContent = requirement.summary;
    checklist.innerHTML = requirement.checklist.map((item) => '<li>' + escapeHtml(item) + '</li>').join('');
    disclaimer.textContent = requirement.disclaimer;
    card.classList.remove('hidden');
    card.removeAttribute('hidden');
  }

  function syncTripLengthDisplay(departureInput, returnInput, pill, nightsInput = null) {
    const departureDate = departureInput?.value || '';
    const returnDate = returnInput?.value || '';
    const todayDateValue = getTodayDateValue();
    if (departureInput) departureInput.min = todayDateValue;
    if (returnInput) {
      const returnMin = departureDate && departureDate > todayDateValue ? departureDate : todayDateValue;
      returnInput.min = returnMin;
    }
    const metrics = getTripMetrics(departureDate, returnDate);
    if (pill) {
      pill.textContent = metrics.label;
      pill.dataset.state = metrics.state;
    }
    if (nightsInput && metrics.state === 'roundtrip') nightsInput.value = String(Math.max(1, metrics.nights || 1));
    return metrics;
  }

  function syncHeroTripInputs() {
    return syncTripLengthDisplay(document.getElementById('heroDateInput'), document.getElementById('heroReturnDateInput'), document.getElementById('heroTripLength'));
  }

  function syncPlannerTripInputs() {
    return syncTripLengthDisplay(document.getElementById('planTravelDate'), document.getElementById('planReturnDate'), document.getElementById('planTripLength'), document.getElementById('planHotelNights'));
  }

  function getStayInputs() {
    const destination = document.getElementById('planDestination')?.value?.trim() || '';
    const travelDate = document.getElementById('planTravelDate')?.value || new Date().toISOString().slice(0, 10);
    const returnDate = document.getElementById('planReturnDate')?.value || '';
    const travelers = Math.max(1, parseInt(document.getElementById('planNumTravelers')?.value, 10) || 1);
    const metrics = getTripMetrics(travelDate, returnDate);
    let nights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    let checkout = buildCheckoutDate(travelDate, nights);
    if (metrics.state === 'roundtrip' && returnDate) {
      nights = Math.max(1, metrics.nights || 1);
      checkout = metrics.nights > 0 ? returnDate : buildCheckoutDate(travelDate, 1);
    }
    const adults = Math.max(1, parseInt(document.getElementById('planHotelAdults')?.value, 10) || travelers);
    const hotelType = document.querySelector('input[name="hotel_type"]:checked')?.value || 'midrange';
    return { destination, checkin: travelDate, checkout, nights, adults, hotelType, returnDate: returnDate || null, tripDays: metrics.days || null };
  }

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()))];
  }

  function buildHotelPhotoPlaceholder(hotel, label, theme) {
    const hotelName = escapeHtml(String(hotel?.name || 'Hotel').slice(0, 34));
    const destinationName = escapeHtml(String(document.getElementById('planDestination')?.value?.trim() || 'Destination').slice(0, 22));
    const category = escapeHtml(String(hotel?.category || hotel?.type || 'stay').slice(0, 18));
    const previewLabel = escapeHtml(String(label || 'Preview').slice(0, 20));
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img" aria-label="${hotelName} ${previewLabel}">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${theme.start}" />
            <stop offset="100%" stop-color="${theme.end}" />
          </linearGradient>
        </defs>
        <rect width="1200" height="900" fill="#09111f" />
        <rect x="54" y="54" width="1092" height="792" rx="38" fill="url(#g)" opacity="0.92" />
        <circle cx="930" cy="180" r="128" fill="rgba(255,255,255,0.16)" />
        <circle cx="210" cy="710" r="176" fill="rgba(255,255,255,0.12)" />
        <rect x="116" y="520" width="518" height="160" rx="24" fill="rgba(6,14,30,0.18)" />
        <rect x="710" y="300" width="248" height="248" rx="26" fill="rgba(6,14,30,0.14)" />
        <text x="120" y="326" fill="#ffffff" font-family="Arial, sans-serif" font-size="74" font-weight="700">${hotelName}</text>
        <text x="120" y="402" fill="rgba(255,255,255,0.88)" font-family="Arial, sans-serif" font-size="34">${destinationName} | ${category}</text>
        <text x="120" y="592" fill="#ffffff" font-family="Arial, sans-serif" font-size="52" font-weight="700">${previewLabel}</text>
        <text x="120" y="648" fill="rgba(255,255,255,0.84)" font-family="Arial, sans-serif" font-size="28">Preview image generated when the hotel provider does not include enough photos.</text>
      </svg>
    `.trim();
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function getHotelGallerySources(hotel) {
    const providerImages = uniqueStrings([
      ...(Array.isArray(hotel?.images) ? hotel.images : []),
      hotel?.image || ''
    ]);
    if (providerImages.length) return [providerImages[0]];
    const fallbackTheme = { start: '#2ec8ff', end: '#0b5fb4', label: 'Stay' };
    return [buildHotelPhotoPlaceholder(hotel, fallbackTheme.label, fallbackTheme)];
  }

  function isSameHotelSelection(left, right) {
    const leftId = left?.id != null ? String(left.id) : '';
    const rightId = right?.id != null ? String(right.id) : '';
    if (leftId && rightId) return leftId === rightId;
    return String(left?.name || '').trim().toLowerCase() === String(right?.name || '').trim().toLowerCase();
  }

  function getHotelSelectionEntries(plan = selectedHotel) {
    if (!plan) return [];
    const rawEntries = Array.isArray(plan.hotels) && plan.hotels.length ? plan.hotels : [plan];
    return rawEntries
      .filter(Boolean)
      .map((hotel) => ({ ...hotel }))
      .filter((hotel) => hotel.id || hotel.name);
  }

  function buildHotelSelectionEntry(hotel, assignedNights = 1, fallbackType = 'midrange') {
    const nights = Math.max(0, parseInt(assignedNights ?? hotel?.assigned_nights ?? hotel?.total_nights ?? 1, 10) || 0);
    const pricePerNight = Math.max(0, safeNum(hotel?.price_per_night ?? hotel?.price, 0));
    const images = getHotelGallerySources(hotel);
    return {
      id: hotel?.id || null,
      type: hotel?.type || hotel?.category || fallbackType,
      category: hotel?.category || hotel?.type || fallbackType,
      name: hotel?.name || 'Selected Hotel',
      price_per_night: pricePerNight,
      assigned_nights: nights,
      total_nights: nights,
      total_cost: Number((pricePerNight * nights).toFixed(2)),
      rating: hotel?.rating != null ? safeNum(hotel.rating, null) : null,
      simulated: !!hotel?.simulated,
      source: hotel?.source || (hotel?.simulated ? 'simulated' : 'api'),
      distance_to_center_km: hotel?.distance_to_center_km != null ? safeNum(hotel.distance_to_center_km, null) : null,
      distance_to_airport_km: hotel?.distance_to_airport_km != null ? safeNum(hotel.distance_to_airport_km, null) : null,
      cancellation: hotel?.cancellation || null,
      payment: hotel?.payment || null,
      image: images[0] || null,
      images
    };
  }

  function buildHotelSelectionPlan(entries, stayNights, fallbackType = 'midrange') {
    const requestedStayNights = Math.max(1, parseInt(stayNights, 10) || 1);
    const normalizedEntries = (Array.isArray(entries) ? entries : [])
      .map((entry) => buildHotelSelectionEntry(entry, entry?.assigned_nights ?? entry?.total_nights ?? 1, fallbackType))
      .filter((entry) => entry.assigned_nights > 0);

    if (!normalizedEntries.length) return null;

    const cappedEntries = [];
    let remaining = requestedStayNights;
    normalizedEntries.forEach((entry) => {
      if (remaining <= 0) return;
      const nightsForEntry = Math.max(0, Math.min(entry.assigned_nights, remaining));
      if (!nightsForEntry) return;
      remaining -= nightsForEntry;
      cappedEntries.push({
        ...entry,
        assigned_nights: nightsForEntry,
        total_nights: nightsForEntry,
        total_cost: Number((entry.price_per_night * nightsForEntry).toFixed(2))
      });
    });

    if (!cappedEntries.length) return null;

    const totalAssignedNights = cappedEntries.reduce((sum, entry) => sum + entry.assigned_nights, 0);
    const totalCost = cappedEntries.reduce((sum, entry) => sum + safeNum(entry.total_cost, 0), 0);
    const primaryHotel = cappedEntries[0];
    const gallery = uniqueStrings(cappedEntries.flatMap((entry) => entry.images || []).concat(primaryHotel.image || ''));

    return {
      id: cappedEntries.length === 1 ? primaryHotel.id || null : null,
      type: cappedEntries.length === 1 ? primaryHotel.type : (fallbackType || primaryHotel.type || 'midrange'),
      category: cappedEntries.length === 1 ? primaryHotel.category || primaryHotel.type : (fallbackType || primaryHotel.category || 'midrange'),
      name: cappedEntries.length === 1 ? primaryHotel.name : `${cappedEntries.length} hotels selected`,
      primary_name: primaryHotel.name || 'Selected Hotel',
      stay_mode: cappedEntries.length > 1 ? 'split' : 'single',
      price_per_night: totalAssignedNights ? Number((totalCost / totalAssignedNights).toFixed(2)) : 0,
      total_nights: totalAssignedNights,
      remaining_nights: Math.max(0, requestedStayNights - totalAssignedNights),
      total_cost: Number(totalCost.toFixed(2)),
      rating: cappedEntries.length === 1 && primaryHotel.rating != null ? safeNum(primaryHotel.rating, null) : null,
      simulated: cappedEntries.every((entry) => !!entry.simulated),
      source: uniqueStrings(cappedEntries.map((entry) => entry.source).filter(Boolean)).join(',') || null,
      image: gallery[0] || null,
      images: gallery,
      hotels: cappedEntries
    };
  }

  function getSelectedHotelAssignedNights(plan = selectedHotel) {
    return getHotelSelectionEntries(plan).reduce((sum, entry) => sum + Math.max(0, parseInt(entry.assigned_nights ?? entry.total_nights ?? 0, 10) || 0), 0);
  }

  function getUnassignedHotelNights(plan = selectedHotel, stayNights = null) {
    const totalNights = Math.max(1, parseInt(stayNights ?? document.getElementById('planHotelNights')?.value, 10) || 1);
    return Math.max(0, totalNights - getSelectedHotelAssignedNights(plan));
  }

  function findRealtimeHotel(hotelId) {
    return hotelRealtimeOptions.find((hotel) => String(hotel.id || '') === String(hotelId || '')) || null;
  }

  function selectedHotelForPricing() {
    if (!selectedHotel) return null;
    const nights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    const hotelType = document.querySelector('input[name="hotel_type"]:checked')?.value || selectedHotel?.category || selectedHotel?.type || 'midrange';
    return buildHotelSelectionPlan(getHotelSelectionEntries(selectedHotel), nights, hotelType);
  }

  function assignHotelNights(hotelId, requestedNights) {
    const hotel = findRealtimeHotel(hotelId);
    if (!hotel) return null;
    const stayNights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    const hotelType = document.querySelector('input[name="hotel_type"]:checked')?.value || hotel.category || 'midrange';
    const currentPlan = selectedHotelForPricing();
    const currentEntries = getHotelSelectionEntries(currentPlan);
    const existingEntry = currentEntries.find((entry) => isSameHotelSelection(entry, hotel));
    const otherEntries = currentEntries.filter((entry) => !isSameHotelSelection(entry, hotel));
    const currentAssigned = existingEntry ? Math.max(0, parseInt(existingEntry.assigned_nights ?? existingEntry.total_nights ?? 0, 10) || 0) : 0;
    const requested = Math.max(0, parseInt(requestedNights, 10) || 0);
    const othersAssigned = otherEntries.reduce((sum, entry) => sum + Math.max(0, parseInt(entry.assigned_nights ?? entry.total_nights ?? 0, 10) || 0), 0);
    const maxAllowed = Math.max(0, stayNights - othersAssigned);
    const finalAssigned = Math.min(requested, maxAllowed);

    if (requested > maxAllowed && requested !== currentAssigned) {
      notify(`Only ${maxAllowed} night(s) are still available for this stay.`, 'info');
    }

    const updatedEntries = otherEntries.slice();
    if (finalAssigned > 0) {
      updatedEntries.push(buildHotelSelectionEntry(hotel, finalAssigned, hotelType));
    }

    selectedHotel = buildHotelSelectionPlan(updatedEntries, stayNights, hotelType);
    updateSelectedHotelSummary();
    renderHotelsStepList();
    return selectedHotel;
  }

  function useHotelForEntireStay(hotelId) {
    const hotel = findRealtimeHotel(hotelId);
    if (!hotel) return null;
    const stayNights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    const hotelType = document.querySelector('input[name="hotel_type"]:checked')?.value || hotel.category || 'midrange';
    selectedHotel = buildHotelSelectionPlan([buildHotelSelectionEntry(hotel, stayNights, hotelType)], stayNights, hotelType);
    updateSelectedHotelSummary();
    renderHotelsStepList();
    return selectedHotel;
  }

  function applySelectedHotelToOptions(options) {
    const hotel = selectedHotelForPricing();
    if (!hotel || !Array.isArray(options)) return options || [];
    return options.map((opt) => {
      const existingHotelCost = opt && opt.hotel && opt.hotel.total_cost != null ? safeNum(opt.hotel.total_cost, 0) : 0;
      const currentTotal = opt && opt.total_cost != null ? safeNum(opt.total_cost, 0) : 0;
      const transportOnly = Math.max(0, currentTotal - existingHotelCost);
      return {
        ...opt,
        hotel,
        total_cost: transportOnly + hotel.total_cost,
        total_with_hotel: transportOnly + hotel.total_cost
      };
    });
  }

  function getHotelTotal(opt) {
    return opt && opt.hotel && opt.hotel.total_cost != null ? safeNum(opt.hotel.total_cost, 0) : 0;
  }

  function getCombinedCost(opt) {
    if (!opt) return 0;
    if (opt.total_with_hotel != null) return safeNum(opt.total_with_hotel, 0);
    if (opt.total_cost != null) return safeNum(opt.total_cost, 0);
    return (opt.legs || []).reduce((sum, leg) => sum + safeNum(leg.estimated_cost, 0), 0);
  }

  function getTransportCost(opt) {
    return Math.max(0, getCombinedCost(opt) - getHotelTotal(opt));
  }

  function getPriceLabel(opt) {
    const modes = Array.isArray(opt?.modes) ? opt.modes : [];
    if (modes.length === 1 && modes[0] === 'flight') return 'flight fare';
    return 'transport only';
  }

  function getConnectionLabel(opt) {
    const modes = Array.isArray(opt?.modes) ? opt.modes : [];
    const legs = Array.isArray(opt?.legs) ? opt.legs : [];
    const isFlightOnly = modes.length === 1 && modes[0] === 'flight';
    if (isFlightOnly) {
      const stops = opt && opt.stop_count != null
        ? Math.max(0, parseInt(opt.stop_count, 10) || 0)
        : (opt && opt.direct === false ? 1 : 0);
      if (stops <= 0) return 'Direct flight';
      return stops === 1 ? '1 connection' : `${stops} connections`;
    }

    const transfers = Math.max(0, legs.length - 1);
    if (transfers <= 0) return 'Direct route';
    return transfers === 1 ? '1 connection' : `${transfers} connections`;
  }

  function updateSelectedOptionAction() {
    const action = document.getElementById('selectedOptionAction');
    const summary = document.getElementById('selectedOptionSummary');
    if (!action || !summary) return;
    if (!pendingReviewCard) {
      action.classList.add('hidden');
      summary.textContent = 'Choose a route above, pick any events you want, then continue.';
      return;
    }

    const opt = JSON.parse(pendingReviewCard.dataset.option || '{}');
    const carrier = opt.carrier || (opt.legs && opt.legs[0] && opt.legs[0].modeName) || 'Selected route';
    const transportCost = getTransportCost(opt);
    const stayTotal = getHotelTotal(opt);
    const connectionLabel = getConnectionLabel(opt);
    summary.textContent = `${carrier} | ${connectionLabel} | INR ${transportCost.toLocaleString('en-IN')} ${getPriceLabel(opt)}${stayTotal ? ` | stay INR ${stayTotal.toLocaleString('en-IN')} separate` : ''}`;
    action.classList.remove('hidden');
  }

  function selectTripOption(card) {
    if (!card) return;
    pendingReviewCard = card;
    document.querySelectorAll('.option-card').forEach((item) => item.classList.toggle('selected', item === card));
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    updateSelectedOptionAction();
    document.getElementById('destinationEvents')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateSelectedHotelSummary() {
    const box = document.getElementById('selectedHotelSummary');
    if (!box) return;
    const stayNights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    const plan = selectedHotelForPricing();
    if (!plan) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    const entries = getHotelSelectionEntries(plan);
    const remainingNights = Math.max(0, stayNights - plan.total_nights);
    const label = entries.length > 1 ? 'Selected stays' : 'Selected stay';

    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="selected-hotel-summary-head">
        <strong>${label}</strong>
        <button type="button" class="btn btn-ghost btn-clear-selected-hotels">Clear stay picks</button>
      </div>
      <div class="selected-hotel-summary-total">
        ${plan.total_nights}/${stayNights} night(s) assigned | Stay total: INR ${safeNum(plan.total_cost, 0).toLocaleString('en-IN')}
      </div>
      ${remainingNights ? `<div class="selected-hotel-summary-note">Assign ${remainingNights} more night(s) or clear the custom selection to use the default ${escapeHtml(document.querySelector('input[name="hotel_type"]:checked')?.value || 'stay')} estimate.</div>` : ''}
      <div class="selected-hotel-items">
        ${entries.map((hotel) => {
          const nights = Math.max(1, parseInt(hotel.assigned_nights ?? hotel.total_nights ?? 1, 10) || 1);
          const rating = hotel.rating != null ? `${safeNum(hotel.rating, 0).toFixed(1)}/10` : 'No rating';
          return `
            <div class="selected-hotel-item">
              <div>
                <div class="selected-hotel-item-name">${escapeHtml(hotel.name || 'Hotel')}</div>
                <div class="selected-hotel-item-meta">${nights} night${nights === 1 ? '' : 's'} | INR ${safeNum(hotel.price_per_night, 0).toLocaleString('en-IN')}/night | ${escapeHtml(rating)}</div>
              </div>
              <span class="hotel-tag">INR ${safeNum(hotel.total_cost, 0).toLocaleString('en-IN')}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;

    box.querySelector('.btn-clear-selected-hotels')?.addEventListener('click', () => {
      selectedHotel = null;
      updateSelectedHotelSummary();
      renderHotelsStepList();
    });
  }

  function renderHotelsStepList() {
    const list = document.getElementById('wizardHotelsList');
    if (!list) return;
    const maxPrice = safeNum(document.getElementById('hotelMaxPrice')?.value, 0);
    const minRating = safeNum(document.getElementById('hotelMinRating')?.value, 0);
    const sortBy = document.getElementById('hotelSortBy')?.value || 'price_asc';
    const nights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    const hotelType = document.querySelector('input[name="hotel_type"]:checked')?.value || 'midrange';
    const plan = selectedHotelForPricing();
    const remainingNights = getUnassignedHotelNights(plan, nights);

    let hotels = (hotelRealtimeOptions || []).filter((hotel) => {
      const priceOk = !maxPrice || safeNum(hotel.price, 0) <= maxPrice;
      const ratingVal = hotel.rating != null ? safeNum(hotel.rating, 0) : 0;
      const ratingOk = !minRating || ratingVal >= minRating;
      const typeOk = !hotelType || !hotel.category || hotel.category === hotelType;
      return priceOk && ratingOk && typeOk;
    });

    hotels = hotels.sort((a, b) => {
      if (sortBy === 'price_desc') return safeNum(b.price, 0) - safeNum(a.price, 0);
      if (sortBy === 'rating_desc') return safeNum(b.rating, 0) - safeNum(a.rating, 0);
      return safeNum(a.price, 0) - safeNum(b.price, 0);
    });

    if (!hotels.length) {
      list.innerHTML = '<div class="section-empty">No hotels match your filters. Try widening price or rating filters.</div>';
      return;
    }

    const helperText = nights > 1
      ? `Split ${nights} night(s) across one or more hotels. ${remainingNights ? `${remainingNights} night(s) still unassigned.` : 'All nights are assigned.'}`
      : 'Pick one hotel for the stay, or leave it unselected to keep the default stay estimate.';

    list.innerHTML = `
      <div class="hotel-allocation-banner">${escapeHtml(helperText)}</div>
      ${hotels.map((hotel, idx) => {
        const id = hotel.id || `hotel-${idx}`;
        const price = Math.max(0, safeNum(hotel.price, 0));
        const rating = hotel.rating != null ? `${safeNum(hotel.rating, 0).toFixed(1)}/10` : 'No rating';
        const total = price * nights;
        const selectedEntry = getHotelSelectionEntries(plan).find((entry) => isSameHotelSelection(entry, hotel));
        const assignedNights = selectedEntry ? Math.max(0, parseInt(selectedEntry.assigned_nights ?? selectedEntry.total_nights ?? 0, 10) || 0) : 0;
        const distanceCenter = hotel.distance_to_center_km != null ? `${safeNum(hotel.distance_to_center_km, 0).toFixed(1)} km to center` : 'Center distance n/a';
        const distanceAirport = hotel.distance_to_airport_km != null ? `${safeNum(hotel.distance_to_airport_km, 0).toFixed(1)} km to airport` : 'Airport distance n/a';
        const previewImage = getHotelGallerySources(hotel)[0] || '';
        return `
          <div class="hotel-card card ${assignedNights ? 'selected' : ''}" data-hotel-id="${id}">
            <div class="hotel-head">
              <div class="hotel-title-stack">
                <div class="hotel-title-row">
                  <strong>${escapeHtml(hotel.name || 'Hotel')}</strong>
                  <button type="button" class="btn btn-ghost btn-view-hotel-photos" data-hotel-id="${id}">Preview</button>
                </div>
                <div class="hotel-meta">
                  <span>${escapeHtml(rating)}</span>
                  <span>Stay total: INR ${total.toLocaleString('en-IN')}</span>
                  <span>${escapeHtml(distanceCenter)}</span>
                  <span>${escapeHtml(distanceAirport)}</span>
                </div>
              </div>
              <span class="hotel-price">INR ${price.toLocaleString('en-IN')}${hotel.simulated ? '/night (est.)' : '/night'}</span>
            </div>
            <div class="hotel-tags">
              <span class="hotel-tag">${escapeHtml(hotel.category || 'stay')}</span>
              <span class="hotel-tag">${escapeHtml(hotel.cancellation || 'Cancellation info unavailable')}</span>
              <span class="hotel-tag">${escapeHtml(hotel.payment || 'Payment info unavailable')}</span>
            </div>
            <button type="button" class="hotel-cover btn-view-hotel-photos" data-hotel-id="${id}" aria-label="Preview ${escapeHtml(hotel.name || 'Hotel')}">
              <img src="${previewImage}" alt="${escapeHtml((hotel.name || 'Hotel') + ' preview')}" loading="lazy">
            </button>
            ${nights > 1 ? `
              <div class="hotel-allocation-row">
                <label class="hotel-night-label" for="hotel-night-${id}">Nights in this hotel</label>
                <div class="hotel-night-control">
                  <input type="number" id="hotel-night-${id}" class="hotel-night-input" data-hotel-id="${id}" min="0" max="${nights}" value="${assignedNights}">
                  <button type="button" class="btn btn-ghost btn-fill-hotel" data-hotel-id="${id}">Use full stay</button>
                </div>
              </div>
              <div class="hotel-actions">
                <button type="button" class="btn ${assignedNights ? 'btn-selected' : 'btn-ghost'} btn-assign-hotel" data-hotel-id="${id}" data-current-nights="${assignedNights}">${assignedNights ? 'Add 1 more night' : 'Add this hotel'}</button>
                ${assignedNights ? `<button type="button" class="btn btn-ghost btn-clear-hotel" data-hotel-id="${id}">Remove</button>` : ''}
              </div>
            ` : `
              <div class="hotel-actions">
                <button type="button" class="btn ${assignedNights ? 'btn-selected' : 'btn-ghost'} btn-pick-hotel" data-hotel-id="${id}">${assignedNights ? 'Selected' : 'Select this hotel'}</button>
              </div>
            `}
          </div>
        `;
      }).join('')}
    `;

    list.querySelectorAll('.btn-view-hotel-photos').forEach((btn) => {
      btn.addEventListener('click', () => openHotelPhotoModal(btn.getAttribute('data-hotel-id')));
    });

    list.querySelectorAll('.btn-pick-hotel').forEach((btn) => {
      btn.addEventListener('click', () => useHotelForEntireStay(btn.getAttribute('data-hotel-id')));
    });

    list.querySelectorAll('.hotel-night-input').forEach((input) => {
      const commit = () => assignHotelNights(input.getAttribute('data-hotel-id'), input.value);
      input.addEventListener('change', commit);
    });

    list.querySelectorAll('.btn-fill-hotel').forEach((btn) => {
      btn.addEventListener('click', () => useHotelForEntireStay(btn.getAttribute('data-hotel-id')));
    });

    list.querySelectorAll('.btn-assign-hotel').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hotelId = btn.getAttribute('data-hotel-id');
        const currentNights = Math.max(0, parseInt(btn.getAttribute('data-current-nights'), 10) || 0);
        assignHotelNights(hotelId, currentNights + 1);
      });
    });

    list.querySelectorAll('.btn-clear-hotel').forEach((btn) => {
      btn.addEventListener('click', () => assignHotelNights(btn.getAttribute('data-hotel-id'), 0));
    });
  }

  async function refreshStayHotels(forceReload = false) {
    const list = document.getElementById('wizardHotelsList');
    if (!list) return;
    const stay = getStayInputs();
    if (!stay.destination) {
      list.innerHTML = '<div class="section-empty">Enter destination in Step 1 to load hotel options.</div>';
      selectedHotel = null;
      updateSelectedHotelSummary();
      return;
    }
    const fetchKey = `${stay.destination}|${stay.checkin}|${stay.checkout}|${stay.adults}|${stay.hotelType}`;
    if (!forceReload && hotelRealtimeOptions.length && hotelFetchKey === fetchKey) {
      renderHotelsStepList();
      return;
    }
    hotelFetchKey = fetchKey;
    list.innerHTML = '<p class="loading">Loading hotel prices...</p>';
    try {
      const q = new URLSearchParams({
        destination: stay.destination,
        checkin: stay.checkin,
        checkout: stay.checkout,
        adults: String(stay.adults),
        hotel_type: stay.hotelType
      });
      const data = await fetchJSON(API + '/hotels?' + q.toString());
      hotelRealtimeOptions = (data.hotels || []).map((hotel, i) => ({
        ...hotel,
        id: hotel.id || `hotel-${i + 1}`,
        category: hotel.category || (safeNum(hotel.price, 0) <= 1800 ? 'hostel' : safeNum(hotel.price, 0) <= 3200 ? 'budget' : safeNum(hotel.price, 0) <= 7000 ? 'midrange' : safeNum(hotel.price, 0) <= 9000 ? 'apartment' : 'luxury')
      }));

      const refreshedEntries = getHotelSelectionEntries(selectedHotel).map((entry) => {
        const liveHotel = hotelRealtimeOptions.find((hotel) => isSameHotelSelection(hotel, entry));
        if (!liveHotel) return null;
        return buildHotelSelectionEntry(liveHotel, entry.assigned_nights ?? entry.total_nights ?? 1, stay.hotelType);
      }).filter(Boolean);
      selectedHotel = buildHotelSelectionPlan(refreshedEntries, stay.nights, stay.hotelType);

      renderHotelsStepList();
      updateSelectedHotelSummary();
    } catch (_) {
      list.innerHTML = '<div class="section-empty">Could not load hotel prices right now. Try again in a few seconds.</div>';
    }
  }

  function closeHotelPhotoModal() {
    document.getElementById('hotelPhotoModal')?.classList.add('hidden');
  }

  function openHotelPhotoModal(hotelId) {
    const hotel = findRealtimeHotel(hotelId);
    const modal = document.getElementById('hotelPhotoModal');
    const title = document.getElementById('hotelPhotoTitle');
    const subtitle = document.getElementById('hotelPhotoSubtitle');
    const gallery = document.getElementById('hotelPhotoGallery');
    if (!hotel || !modal || !title || !subtitle || !gallery) return;

    const photos = getHotelGallerySources(hotel);
    const rating = hotel.rating != null ? `${safeNum(hotel.rating, 0).toFixed(1)}/10` : 'No rating';
    title.textContent = hotel.name || 'Hotel preview';
    subtitle.textContent = `${rating} | ${hotel.category || 'stay'} | ${hotel.simulated ? 'Preview image' : 'Provider image'}`;
    gallery.innerHTML = photos.map((src, index) => `
      <figure class="hotel-photo-frame">
        <img src="${src}" alt="${escapeHtml((hotel.name || 'Hotel') + ' photo ' + (index + 1))}" loading="lazy">
        <figcaption>${escapeHtml(hotel.name || 'Hotel')} | Preview</figcaption>
      </figure>
    `).join('');
    modal.classList.remove('hidden');
  }

  document.getElementById('closeHotelPhotoModal')?.addEventListener('click', closeHotelPhotoModal);
  document.getElementById('hotelPhotoModal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'hotelPhotoModal') closeHotelPhotoModal();
  });

  async function checkAuth() {
    try {
      const { user } = await fetchJSON(API + '/auth/me');
      setAuthUI(user);
      return user;
    } catch (_) {
      setAuthUI(null);
      return null;
    }
  }

  // Logout
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    try {
      await fetch(API + '/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (_) { }
    window.location.replace('/login?logout=1');
  });

  document.getElementById('btnContinueSelectedOption')?.addEventListener('click', () => {
    if (!pendingReviewCard) {
      notify('Choose an option first.', 'error');
      return;
    }
    goToReview(pendingReviewCard);
  });

  // Nav links
  document.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      if (link.tagName === 'A') e.preventDefault();
      const page = link.dataset.page;
      showPage(page);
    });
  });

  // Wizard: step navigation
  function showWizardStep(step) {
    document.querySelectorAll('.wizard-step').forEach(s => s.classList.toggle('active', parseInt(s.dataset.step, 10) === step));
    document.querySelectorAll('.wizard-panel').forEach((p) => {
      const isActive = p.id === 'wizardStep' + step;
      p.classList.toggle('active', isActive);
      p.hidden = !isActive;
    });
    const panel = document.getElementById('wizardStep' + step);
    if (panel) {
      panel.classList.add('active');
      panel.hidden = false;
      if (step === 2) renderTravelRequirementsNotice();
      scrollViewportTo(document.querySelector('#page-plan .wizard-steps') || panel);
      const focusTarget = panel.querySelector('input, select, button');
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
  }

  function initPlanPage() {
    document.getElementById('planResults').classList.add('hidden');
    hotelRealtimeOptions = [];
    selectedHotel = null;
    hotelFetchKey = '';
    pendingReviewCard = null;
    updateSelectedHotelSummary();
    updateSelectedOptionAction();
    syncPlannerTripInputs();
    showWizardStep(1);
  }

  document.getElementById('wizardNext1')?.addEventListener('click', async () => {
    const s = document.getElementById('planSource');
    const d = document.getElementById('planDestination');
    const t = document.getElementById('planTravelDate');
    const r = document.getElementById('planReturnDate');
    const err = document.getElementById('wizardStep1Error');
    if (err) {
      err.classList.add('hidden');
      err.textContent = '';
    }
    if (!s?.value?.trim() || !d?.value?.trim() || !t?.value) {
      if (err) {
        err.textContent = 'Please enter source, destination, and departure date.';
        err.classList.remove('hidden');
      } else {
        notify('Please enter source, destination, and departure date.', 'error');
      }
      return;
    }
    const tripError = getTripValidationMessage(t.value, r?.value || '');
    if (tripError) {
      if (err) {
        err.textContent = tripError;
        err.classList.remove('hidden');
      } else {
        notify(tripError, 'error');
      }
      return;
    }
    await Promise.all([ensureInputLocationData(s), ensureInputLocationData(d)]);
    syncPlannerTripInputs();
    renderTravelRequirementsNotice();
    showWizardStep(2);
  });
  document.getElementById('wizardBack2')?.addEventListener('click', () => showWizardStep(1));
  document.getElementById('wizardNext2')?.addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('input[name="transport"]:checked'));
    const err = document.getElementById('wizardStep2Error');
    if (!selected.length) {
      if (err) {
        err.textContent = 'Select at least one transport mode to continue.';
        err.classList.remove('hidden');
      } else {
        notify('Select at least one transport mode to continue.', 'error');
      }
      return;
    }
    if (err) {
      err.classList.add('hidden');
      err.textContent = '';
    }
    const stayAdults = document.getElementById('planHotelAdults');
    const travelers = Math.max(1, parseInt(document.getElementById('planNumTravelers')?.value, 10) || 1);
    if (stayAdults && (!stayAdults.value || safeNum(stayAdults.value, 0) < 1)) stayAdults.value = String(travelers);
    showWizardStep(3);
    await refreshStayHotels(true);
  });
  document.getElementById('wizardBack3')?.addEventListener('click', () => showWizardStep(2));
  document.getElementById('wizardNext3')?.addEventListener('click', () => {
    const stayNights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    const plan = selectedHotelForPricing();
    if (plan && stayNights > 1 && plan.total_nights < stayNights) {
      notify(`Assign ${stayNights - plan.total_nights} more night(s) or clear the custom stay picks to use the default stay estimate.`, 'error');
      return;
    }
    showWizardStep(4);
  });
  document.getElementById('wizardBack4')?.addEventListener('click', () => showWizardStep(3));
  document.getElementById('planHotelNights')?.addEventListener('change', async () => {
    updateSelectedHotelSummary();
    await refreshStayHotels(true);
  });
  document.getElementById('planHotelAdults')?.addEventListener('change', async () => {
    await refreshStayHotels(true);
  });
  document.getElementById('hotelMaxPrice')?.addEventListener('input', renderHotelsStepList);
  document.getElementById('hotelMinRating')?.addEventListener('change', renderHotelsStepList);
  document.getElementById('hotelSortBy')?.addEventListener('change', renderHotelsStepList);
  document.getElementById('planDestination')?.addEventListener('change', async () => {
    renderTravelRequirementsNotice();
    if (document.getElementById('wizardStep3')?.classList.contains('active')) await refreshStayHotels(true);
  });
  const handlePlanDateChange = async () => {
    syncPlannerTripInputs();
    if (document.getElementById('wizardStep3')?.classList.contains('active')) await refreshStayHotels(true);
  };
  document.getElementById('planTravelDate')?.addEventListener('change', handlePlanDateChange);
  document.getElementById('planReturnDate')?.addEventListener('change', handlePlanDateChange);
  document.getElementById('planSource')?.addEventListener('change', renderTravelRequirementsNotice);
  document.getElementById('planSource')?.addEventListener('input', renderTravelRequirementsNotice);
  document.getElementById('planDestination')?.addEventListener('input', renderTravelRequirementsNotice);
  document.querySelectorAll('input[name="hotel_type"]').forEach(r => {
    r.addEventListener('change', async () => {
      selectedHotel = null;
      updateSelectedHotelSummary();
      await refreshStayHotels(true);
    });
  });

  document.getElementById('wizardSubmit')?.addEventListener('click', async () => {
    const submitBtn = document.getElementById('wizardSubmit');
    const sourceInput = document.getElementById('planSource');
    const destinationInput = document.getElementById('planDestination');
    const source = sourceInput?.value?.trim();
    const destination = destinationInput?.value?.trim();
    const travel_date = document.getElementById('planTravelDate')?.value || null;
    const return_date = document.getElementById('planReturnDate')?.value || null;
    const tripMetrics = syncPlannerTripInputs();

    if (!source || !destination || !travel_date) {
      notify('Please enter source, destination, and departure date.', 'error');
      return;
    }
    if (tripMetrics.invalid) {
      notify('Return date must be on or after the departure date.', 'error');
      return;
    }

    const num_travelers = Math.max(1, parseInt(document.getElementById('planNumTravelers')?.value, 10) || 1);
    const budget = document.getElementById('planBudget')?.value ? parseFloat(document.getElementById('planBudget').value) : null;
    const preference_type = document.getElementById('planPreference')?.value || null;
    const transport_choice = Array.from(document.querySelectorAll('input[name="transport"]:checked')).map((c) => c.value);
    const hotel_type = document.querySelector('input[name="hotel_type"]:checked')?.value || 'midrange';
    const hotel_nights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || (tripMetrics.nights || 2));
    const hotel_adults = Math.max(1, parseInt(document.getElementById('planHotelAdults')?.value, 10) || num_travelers);
    const selected_hotel = selectedHotelForPricing();
    if (selected_hotel && selected_hotel.total_nights < hotel_nights) {
      notify(`Assign ${hotel_nights - selected_hotel.total_nights} more night(s) or clear the custom stay picks to use the default stay estimate.`, 'error');
      showWizardStep(3);
      return;
    }
    const resultsEl = document.getElementById('planResults');
    const optionsList = document.getElementById('optionsList');
    const realTimeBadge = document.getElementById('realTimeBadge');
    optionsList.innerHTML = '<p class="loading">Loading options and live prices...</p>';
    resultsEl.classList.remove('hidden');
    if (realTimeBadge) realTimeBadge.classList.add('hidden');
    setButtonLoading(submitBtn, 'Loading options...', true);
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const prefs = await getPreferencesForPlan();
      await Promise.all([ensureInputLocationData(sourceInput), ensureInputLocationData(destinationInput)]);
      const source_id = getInputLocationId(sourceInput) || null;
      const destination_id = getInputLocationId(destinationInput) || null;
      const data = await fetchJSON(API + '/travel/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          destination,
          travel_date,
          return_date,
          start_date: travel_date,
          end_date: return_date,
          source_id,
          destination_id,
          num_travelers,
          budget,
          preference_type,
          transport_choice: transport_choice.length ? transport_choice : null,
          hotel_type,
          hotel_nights,
          hotel_adults,
          selected_hotel,
          preferences: prefs
        })
      });

      if (data.real_time_prices && realTimeBadge) realTimeBadge.classList.remove('hidden');
      const optionsWithSelectedHotel = applySelectedHotelToOptions(data.options || []);
      const selectedReturnDate = return_date || data.return_date || null;
      const resolvedTripMetrics = getTripMetrics(travel_date, selectedReturnDate);

      optionsList.innerHTML = '';
      pendingReviewCard = null;
      updateSelectedOptionAction();
      optionsWithSelectedHotel.forEach((opt, i) => {
        const card = document.createElement('div');
        card.className = 'option-card' + (i === 0 ? ' recommended' : '');
        const modes = (opt.modes || opt.legs?.map((l) => l.modeName || l.mode) || []);
        const modesText = modes.join(' -> ');
        const transportCost = getTransportCost(opt);
        const stayTotal = getHotelTotal(opt);
        const duration = opt.total_duration_minutes != null ? opt.total_duration_minutes : (opt.legs || []).reduce((sum, leg) => sum + (leg.duration_minutes || 0), 0);
        const dist = opt.total_distance_km != null ? opt.total_distance_km : (opt.legs || []).reduce((sum, leg) => sum + (leg.distance_km || 0), 0);
        const hotel = opt.hotel;
        const hotelLine = hotel
          ? buildHotelStaySummaryText(hotel)
          : 'Stay details not available';
        const primaryCarrier = opt.carrier || (opt.legs && opt.legs[0] && opt.legs[0].modeName) || 'Multimodal';
        const refCode = opt.quote_id || opt.id || `OPT-${i + 1}`;
        const connectionLabel = getConnectionLabel(opt);
        const sourceCode = (source || 'SRC').slice(0, 3).toUpperCase();
        const destCode = (destination || 'DST').slice(0, 3).toUpperCase();
        const hours = Math.floor(duration / 60);
        const mins = duration % 60;
        const baseDep = travel_date ? new Date(`${travel_date}T06:00:00`) : new Date();
        baseDep.setHours(6 + (i % 10), (i * 7) % 60, 0, 0);
        const baseArr = new Date(baseDep.getTime() + (duration * 60 * 1000));
        const depTime = formatTimeLabel(opt.outbound, baseDep);
        const arrTime = formatTimeLabel(opt.arrival, baseArr);
        const apiPriceLine = opt.from_api && opt.price_total != null ? `<span>Flight fare: INR ${safeNum(opt.price_total, 0).toLocaleString('en-IN')}</span>` : '';
        const tripLine = selectedReturnDate ? `Round trip - ${getTripLengthLabel(resolvedTripMetrics.days, resolvedTripMetrics.nights)}` : 'One-way';
        card.innerHTML = `
          <div class="option-g-main">
            <div class="option-g-head">
              <span class="option-modes">${escapeHtml(primaryCarrier)}${opt.from_api ? ' <span class="api-badge">Live price</span>' : ''}</span>
              <span class="option-g-ref">${escapeHtml(refCode)}</span>
            </div>
            <div class="option-g-route">
              <div class="option-g-timeblock">
                <span class="option-g-time">${escapeHtml(depTime)}</span>
                <span class="option-g-code">${escapeHtml(sourceCode)}</span>
              </div>
              <div class="option-g-mid">
                <span class="option-g-duration">${hours}h ${mins}m</span>
                <div class="option-g-line"></div>
                <span class="option-g-sub">${escapeHtml(connectionLabel)} - ${dist.toFixed(0)} km</span>
              </div>
              <div class="option-g-timeblock">
                <span class="option-g-time">${escapeHtml(arrTime)}</span>
                <span class="option-g-code">${escapeHtml(destCode)}</span>
              </div>
            </div>
            <div class="option-stats">
              ${apiPriceLine}
              <span>${escapeHtml(modesText || 'Multimodal')}</span>
              <span>${escapeHtml(tripLine)}</span>
              <span>${hotelLine}</span>
            </div>
          </div>
          <div class="option-g-side">
            <div class="option-g-price">INR ${(transportCost || 0).toFixed(2)}</div>
            <div class="option-g-price-sub">${escapeHtml(getPriceLabel(opt))}</div>
            <div class="option-actions">
              <button type="button" class="btn btn-primary btn-select-review" data-index="${i}">Choose option</button>
              <button type="button" class="btn btn-ghost btn-save-option" data-index="${i}">Save only</button>
            </div>
          </div>
        `;
        card.dataset.option = JSON.stringify(opt);
        card.dataset.source = source;
        card.dataset.destination = destination;
        card.dataset.travel_date = travel_date || '';
        card.dataset.return_date = selectedReturnDate || opt.return_date || '';
        card.dataset.end_date = selectedReturnDate || opt.return_date || '';
        card.dataset.source_id = source_id || '';
        card.dataset.destination_id = destination_id || '';
        card.dataset.trip_days = resolvedTripMetrics.days != null ? String(resolvedTripMetrics.days) : '';
        card.dataset.trip_nights = resolvedTripMetrics.nights != null ? String(resolvedTripMetrics.nights) : '';
        card.dataset.budget = budget != null ? budget : '';
        card.dataset.preference_type = preference_type || '';
        card.dataset.num_travelers = num_travelers;
        card.dataset.hotel_type = hotel_type;
        card.dataset.hotel_nights = hotel_nights;
        optionsList.appendChild(card);
      });

      if (!optionsWithSelectedHotel || optionsWithSelectedHotel.length === 0) optionsList.innerHTML = '<div class="section-empty">No route options found for this combination. Try another date, city pair, or transport mode.</div>';
      optionsList.querySelectorAll('.btn-select-review').forEach((btn) => btn.addEventListener('click', () => selectTripOption(btn.closest('.option-card'))));
      optionsList.querySelectorAll('.btn-save-option').forEach((btn) => btn.addEventListener('click', () => saveItineraryFromCard(btn.closest('.option-card'))));

      lastPlanData = { transport_choice, options: optionsWithSelectedHotel, source, destination, travel_date, return_date: selectedReturnDate, source_id, destination_id, trip_days: resolvedTripMetrics.days || null, trip_nights: resolvedTripMetrics.nights ?? null, budget, preference_type, num_travelers, hotel_type, hotel_nights, selected_hotel };
      renderMap(source, destination);
      loadEvents(destination, travel_date);
      loadRealTimeFlights(optionsWithSelectedHotel, transport_choice);
      loadFuelCostIfCar(optionsWithSelectedHotel, transport_choice);
      notify('Trip options loaded.', 'success');
    } catch (err) {
      optionsList.innerHTML = '<p class="auth-error">' + (err.message || 'Failed to load options') + '</p>';
      notify(err.message || 'Failed to load options', 'error');
    } finally {
      setButtonLoading(submitBtn, '', false);
    }
  });

  function goToReview(card) {
    const opt = JSON.parse(card.dataset.option || '{}');
    planState = {
      source: card.dataset.source,
      destination: card.dataset.destination,
      travel_date: card.dataset.travel_date || null,
      return_date: card.dataset.return_date || null,
      source_id: card.dataset.source_id || null,
      destination_id: card.dataset.destination_id || null,
      trip_days: card.dataset.trip_days ? parseInt(card.dataset.trip_days, 10) : null,
      trip_nights: card.dataset.trip_nights ? parseInt(card.dataset.trip_nights, 10) : null,
      budget: card.dataset.budget ? parseFloat(card.dataset.budget) : null,
      preference_type: card.dataset.preference_type || null,
      num_travelers: parseInt(card.dataset.num_travelers, 10) || 1,
      selected_option: opt,
      selected_events: getSelectedEventsForPlan()
    };

    if (!planState.itinerary) {
      showItineraryModal(); // This modal's submit will generate itinerary and then show Review/Results
    } else {
      showPage('review');
    }
  }

  // PDF Download Logic
  window.downloadTripPDF = async function () {
    if (!planState) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(22);
    doc.text(`Trip to ${planState.destination}`, 20, 20);

    doc.setFontSize(12);
    doc.text(`Source: ${planState.source}`, 20, 30);
    doc.text(getTripDateLine(planState.travel_date, planState.return_date), 20, 36, { maxWidth: 170 });
    doc.text(`Travelers: ${planState.num_travelers}`, 20, planState.return_date ? 48 : 42);
    if (planState.trip_days) {
      doc.text(`Trip length: ${getTripLengthLabel(planState.trip_days, planState.trip_nights)}`, 20, planState.return_date ? 54 : 48);
    }

    const opt = planState.selected_option;
    const transportCost = getTransportCost(opt);
    const stayTotal = getHotelTotal(opt);
    doc.text(`Transport Fare: ${transportCost.toFixed(2)} INR`, 20, planState.trip_days ? (planState.return_date ? 62 : 56) : (planState.return_date ? 56 : 52));
    if (stayTotal) {
      doc.text(`Stay Total: ${stayTotal.toFixed(2)} INR`, 20, planState.trip_days ? (planState.return_date ? 68 : 62) : (planState.return_date ? 62 : 58));
    }

    let y = stayTotal ? (planState.trip_days ? (planState.return_date ? 81 : 75) : (planState.return_date ? 75 : 71)) : (planState.trip_days ? (planState.return_date ? 75 : 69) : (planState.return_date ? 69 : 65));
    doc.setFontSize(16);
    doc.text('Transport', 20, y);
    y += 10;
    doc.setFontSize(12);
    (opt.legs || []).forEach(leg => {
      doc.text(`- ${leg.modeName} (${leg.duration_minutes}m): ${leg.estimated_cost} INR`, 20, y);
      y += 8;
    });

    const hotelEntries = getHotelSelectionEntries(opt.hotel);
    if (hotelEntries.length) {
      y += 8;
      doc.setFontSize(16);
      doc.text('Stay', 20, y);
      y += 10;
      doc.setFontSize(12);
      hotelEntries.forEach((hotel) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const nights = Math.max(1, parseInt(hotel.assigned_nights ?? hotel.total_nights ?? 1, 10) || 1);
        const hotelLine = `- ${hotel.name}: ${nights} night(s) x INR ${safeNum(hotel.price_per_night, 0).toFixed(2)} = INR ${safeNum(hotel.total_cost, 0).toFixed(2)}`;
        const wrappedHotelLine = doc.splitTextToSize(hotelLine, 170);
        doc.text(wrappedHotelLine, 20, y);
        y += wrappedHotelLine.length * 6;
      });
    }

    if (planState.selected_events && planState.selected_events.length) {
      y += 8;
      doc.setFontSize(16);
      doc.text('Selected Events', 20, y);
      y += 10;
      doc.setFontSize(12);
      planState.selected_events.forEach((event) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const eventLine = `${event.name}${event.venue ? ` - ${event.venue}` : ''}${event.when ? ` (${event.when})` : ''}`;
        doc.text(`- ${eventLine}`, 20, y);
        y += 8;
      });
    }

    if (planState.itinerary) {
      y += 10;
      doc.setFontSize(16);
      doc.text('Itinerary', 20, y);
      y += 10;
      doc.setFontSize(10);

      planState.itinerary.forEach(day => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFont(undefined, 'bold');
        doc.text(`Day ${day.day}`, 20, y);
        y += 6;
        doc.setFont(undefined, 'normal');
        day.activities.forEach(act => {
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text(`${act.time}: ${act.title} (${act.type})`, 25, y);
          y += 6;
        });
        y += 4;
      });
    }

    doc.save('my-trip.pdf');
  };

  document.getElementById('btnDownloadTrip')?.addEventListener('click', window.downloadTripPDF);

  function buildSelectedEventsPreview(events, limit = 2) {
    const selected = Array.isArray(events) ? events : [];
    if (!selected.length) {
      return '<div class="section-empty">No local events selected yet. You can continue with the base trip plan.</div>';
    }

    const visible = limit > 0 ? selected.slice(0, limit) : selected;
    const remaining = limit > 0 ? Math.max(0, selected.length - visible.length) : 0;

    return `
      <div class="event-preview-list">
        ${visible.map((event) => `
          <div class="selected-event-item">
            <strong>${escapeHtml(event.name)}</strong>
            <div class="meta">${escapeHtml(event.venue || 'Venue TBA')}${event.when ? ` | ${escapeHtml(event.when)}` : event.date ? ` | ${escapeHtml(event.date)}` : ''}</div>
          </div>
        `).join('')}
      </div>
      ${remaining ? `<div class="meta" style="margin-top:0.55rem;">+${remaining} more selected event(s) will appear in the final itinerary.</div>` : ''}
    `;
  }

  function buildItineraryGlimpseHtml(itinerary) {
    if (!Array.isArray(itinerary) || !itinerary.length) {
      return '<div class="section-empty">Generate the itinerary to preview the trip structure before payment.</div>';
    }

    const firstDay = itinerary[0] || { day: 1, activities: [] };
    const activities = Array.isArray(firstDay.activities) ? firstDay.activities.slice(0, 3) : [];
    const remainingDays = Math.max(0, itinerary.length - 1);

    return `
      <div class="glimpse-list">
        <div class="glimpse-item">
          <strong>Day ${escapeHtml(firstDay.day)}</strong>
          <div class="meta" style="margin-top:0.35rem;">
            ${activities.length
              ? activities.map((activity) => escapeHtml(`${activity.time || 'TBA'} - ${activity.title || 'Planned activity'}`)).join('<br>')
              : 'Activities will appear after payment.'}
          </div>
        </div>
      </div>
      ${remainingDays ? `<div class="meta" style="margin-top:0.55rem;">+${remainingDays} more planned day(s) unlock after the demo payment step.</div>` : ''}
    `;
  }

  function buildFinalItineraryHtml(itinerary) {
    if (!Array.isArray(itinerary) || !itinerary.length) {
      return '<div class="section-empty">No itinerary generated for this booking.</div>';
    }

    return `
      <div class="itinerary-timeline">
        ${itinerary.map((day) => `
          <div class="day-plan">
            <div class="day-header">Day ${escapeHtml(day.day)}</div>
            ${(Array.isArray(day.activities) ? day.activities : []).map((activity) => `
              <div class="activity-item">
                <span class="activity-time">${escapeHtml(activity.time || 'TBA')}</span>
                <div class="activity-content">
                  <span class="activity-title">${escapeHtml(activity.title || 'Planned activity')}</span>
                  <span class="activity-tag">${escapeHtml(activity.type || 'activity')}</span>
                </div>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    `;
  }

  function buildHotelStaySummaryText(hotelPlan) {
    const entries = getHotelSelectionEntries(hotelPlan);
    if (!entries.length) return 'Stay details not available';
    const totalCost = hotelPlan?.total_cost != null
      ? safeNum(hotelPlan.total_cost, 0)
      : entries.reduce((sum, hotel) => sum + safeNum(hotel.total_cost, 0), 0);
    if (entries.length === 1) {
      const hotel = entries[0];
      const safeName = escapeHtml(hotel.name || 'Hotel');
      const nights = Math.max(1, parseInt(hotel.assigned_nights ?? hotel.total_nights ?? 1, 10) || 1);
      return `Stay: ${safeName} (${nights} night${nights === 1 ? '' : 's'}) - INR ${safeNum(hotel.price_per_night, 0).toLocaleString('en-IN')}/night | stay total INR ${totalCost.toLocaleString('en-IN')} separate`;
    }
    const preview = entries.slice(0, 2)
      .map((hotel) => {
        const safeName = escapeHtml(hotel.name || 'Hotel');
        const nights = Math.max(1, parseInt(hotel.assigned_nights ?? hotel.total_nights ?? 1, 10) || 1);
        return `${safeName} (${nights} night${nights === 1 ? '' : 's'})`;
      })
      .join(', ');
    const extra = entries.length > 2 ? ` + ${entries.length - 2} more` : '';
    return `Stay split across ${entries.length} hotels: ${preview}${extra} | stay total INR ${totalCost.toLocaleString('en-IN')} separate`;
  }

  function buildHotelStayBreakdownHtml(hotelPlan) {
    const entries = getHotelSelectionEntries(hotelPlan);
    if (!entries.length) return '';
    const totalCost = hotelPlan?.total_cost != null
      ? safeNum(hotelPlan.total_cost, 0)
      : entries.reduce((sum, hotel) => sum + safeNum(hotel.total_cost, 0), 0);
    const totalNights = hotelPlan?.total_nights != null
      ? safeNum(hotelPlan.total_nights, 0)
      : entries.reduce((sum, hotel) => sum + Math.max(1, parseInt(hotel.assigned_nights ?? hotel.total_nights ?? 1, 10) || 1), 0);
    const intro = entries.length === 1
      ? `<div class="meta">Stay: ${escapeHtml(entries[0].name)} (${escapeHtml(entries[0].assigned_nights ?? entries[0].total_nights ?? 1)} night(s)) | INR ${safeNum(entries[0].price_per_night, 0).toLocaleString('en-IN')}/night | Separate stay total INR ${totalCost.toLocaleString('en-IN')}</div>`
      : `<div class="meta">Stay split across ${entries.length} hotels | ${escapeHtml(totalNights)} night(s) | Separate stay total INR ${totalCost.toLocaleString('en-IN')}</div>`;

    return `
      ${intro}
      <div class="hotel-selection-list">
        ${entries.map((hotel) => {
          const nights = Math.max(1, parseInt(hotel.assigned_nights ?? hotel.total_nights ?? 1, 10) || 1);
          const rating = hotel.rating != null ? `${safeNum(hotel.rating, 0).toFixed(1)}/10` : 'No rating';
          return `
            <div class="hotel-selection-row">
              <div>
                <strong>${escapeHtml(hotel.name || 'Hotel')}</strong>
                <div class="meta">${nights} night(s) | INR ${safeNum(hotel.price_per_night, 0).toLocaleString('en-IN')}/night | ${escapeHtml(rating)}</div>
              </div>
              <span class="hotel-tag">INR ${safeNum(hotel.total_cost, 0).toLocaleString('en-IN')}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderReviewSummary() {
    const el = document.getElementById('reviewSummary');
    if (!el || !planState) return;
    syncPlanSelectedEvents();
    const opt = planState.selected_option;
    const transportCost = getTransportCost(opt);
    const modes = (opt.modes || opt.legs?.map((leg) => leg.modeName || leg.mode) || []).join(' -> ');
    const hotelHtml = buildHotelStayBreakdownHtml(opt.hotel);
    const tripLengthLine = planState.trip_days ? `<div class="meta">Trip length: ${escapeHtml(getTripLengthLabel(planState.trip_days, planState.trip_nights))}</div>` : '';

    el.innerHTML = `
      <div class="route">${escapeHtml(planState.source)} -> ${escapeHtml(planState.destination)}</div>
      <div class="meta">${escapeHtml(getTripDateLine(planState.travel_date, planState.return_date))} | Travelers: ${escapeHtml(planState.num_travelers)}</div>
      ${tripLengthLine}
      <div class="meta">${escapeHtml(modes || 'Multimodal')} | ${escapeHtml(getConnectionLabel(opt))}</div>
      <div class="meta">Transport fare: INR ${transportCost.toFixed(2)}</div>
      ${hotelHtml}
      <div class="review-block">
        <div class="review-block-title">Selected local events</div>
        ${buildSelectedEventsPreview(planState.selected_events, 2)}
      </div>
      <div class="review-block">
        <div class="review-block-title">Itinerary glimpse</div>
        <div class="meta">Only a short preview is shown here. The full itinerary appears after payment.</div>
        ${buildItineraryGlimpseHtml(planState.itinerary)}
      </div>
    `;
  }

  document.getElementById('btnProceedPayment')?.addEventListener('click', () => showPage('payment'));

  document.getElementById('formPayment')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const payBtn = form.querySelector('button[type="submit"]');
    const name_on_card = form.name_on_card?.value?.trim();
    const card_number = form.card_number?.value?.trim();
    const expiry = form.expiry?.value?.trim();
    const cvv = form.cvv?.value?.trim();
    if (!planState) { notify('Session expired. Please plan again.', 'error'); showPage('plan'); return; }
    setButtonLoading(payBtn, 'Processing payment...', true);
    try {
      const pay = await fetchJSON(API + '/travel/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_number, expiry, cvv, name_on_card })
      });
      const opt = planState.selected_option;
      const total_cost = getTransportCost(opt);
      const confirm = await fetchJSON(API + '/travel/confirm-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source: planState.source,
          destination: planState.destination,
          travel_date: planState.travel_date,
          budget: planState.budget,
          preference_type: planState.preference_type,
          num_travelers: planState.num_travelers,
          selected_option: planState.selected_option,
          selected_events: planState.selected_events || [],
          itinerary: planState.itinerary || [],
          total_cost,
          payment_ref: pay.payment_ref,
          return_date: planState.return_date || null
        })
      });
      planState.booking_id = confirm.booking_id;
      planState.payment_ref = pay.payment_ref;
      showPage('confirmation');
      notify('Payment successful and booking confirmed.', 'success');
    } catch (err) {
      notify(err.message || 'Payment or booking failed', 'error');
    } finally {
      setButtonLoading(payBtn, '', false);
    }
  });

  function renderConfirmation() {
    const el = document.getElementById('confirmationDetails');
    if (!el || !planState) return;
    syncPlanSelectedEvents();
    const opt = planState.selected_option;
    const transportCost = getTransportCost(opt);
    const stayTotal = getHotelTotal(opt);
    const selectedEvents = Array.isArray(planState.selected_events) ? planState.selected_events : [];
    const tripLengthLine = planState.trip_days ? `<div class="meta">Trip length: ${escapeHtml(getTripLengthLabel(planState.trip_days, planState.trip_nights))}</div>` : '';
    el.innerHTML = `
      <div class="route">${escapeHtml(planState.source)} -> ${escapeHtml(planState.destination)}</div>
      <div class="meta">${escapeHtml(getTripDateLine(planState.travel_date, planState.return_date))} | Travelers: ${escapeHtml(planState.num_travelers)}</div>
      ${tripLengthLine}
      <div class="meta">Transport fare paid: INR ${transportCost.toFixed(2)}</div>
      ${stayTotal ? `<div class="meta">Stay selected separately: INR ${stayTotal.toFixed(2)}</div>` : ''}
      ${buildHotelStayBreakdownHtml(opt.hotel)}
      <div class="meta" style="margin-top:0.5rem;">Booking #${escapeHtml(planState.booking_id || 'TBD')} | Payment ref: ${escapeHtml(planState.payment_ref || 'TBD')}</div>
      <div class="confirmation-block">
        <div class="confirmation-block-title">Local events in this booking</div>
        ${buildSelectedEventsPreview(selectedEvents, 0)}
      </div>
      <div class="confirmation-block">
        <div class="confirmation-block-title">Final itinerary</div>
        ${buildFinalItineraryHtml(planState.itinerary)}
      </div>
      <p style="margin-top:0.75rem; color: var(--success);">Data saved for future learning.</p>
    `;
  }

  async function getPreferencesForPlan() {
    try {
      const p = await fetchJSON(API + '/preferences');
      return { preferred_modes: p.preferred_modes, budget_max: p.budget_max };
    } catch (_) {
      return {};
    }
  }

  async function saveItineraryFromCard(card) {
    const saveBtn = card?.querySelector('.btn-save-option');
    const opt = JSON.parse(card.dataset.option || '{}');
    const source = card.dataset.source;
    const destination = card.dataset.destination;
    const start_date = card.dataset.travel_date || card.dataset.start_date;
    const end_date = card.dataset.end_date;
    const total_cost = getTransportCost(opt);
    const total_duration = opt.total_duration_minutes != null ? opt.total_duration_minutes : (opt.legs || []).reduce((s, l) => s + (l.duration_minutes || 0), 0);
    const total_distance_km = opt.total_distance_km != null ? opt.total_distance_km : (opt.legs || []).reduce((s, l) => s + (l.distance_km || 0), 0);
    try {
      setButtonLoading(saveBtn, 'Saving...', true);
      await fetchJSON(API + '/travel/save-itinerary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          destination,
          start_date: start_date || null,
          end_date: end_date || null,
          selected_option: opt,
          total_distance_km,
          total_duration_minutes: total_duration,
          estimated_cost: total_cost,
          itinerary_json: opt
        })
      });
      notify('Itinerary saved.', 'success');
    } catch (e) {
      if (e.message === 'Authentication required') notify('Please log in to save itineraries.', 'error');
      else notify(e.message || 'Failed to save', 'error');
    } finally {
      setButtonLoading(saveBtn, '', false);
    }
  }

  function geocodeGoogleAddress(address) {
    if (!(window.google && window.google.maps && window.google.maps.Geocoder)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        const ok = status === 'OK' || status === window.google?.maps?.GeocoderStatus?.OK;
        if (!ok || !Array.isArray(results) || !results[0]?.geometry?.location) {
          resolve(null);
          return;
        }
        const location = results[0].geometry.location;
        resolve({
          lat: typeof location.lat === 'function' ? location.lat() : location.lat,
          lng: typeof location.lng === 'function' ? location.lng() : location.lng
        });
      });
    });
  }

  function geocodeCity(name) {
    const coords = {
      'new york': [40.7128, -74.006],
      'los angeles': [34.0522, -118.2437],
      'chicago': [41.8781, -87.6298],
      'miami': [25.7617, -80.1918],
      'boston': [42.3601, -71.0589],
      'san francisco': [37.7749, -122.4194],
      'las vegas': [36.1699, -115.1398],
      'delhi': [28.6139, 77.2090],
      'mumbai': [19.0760, 72.8777],
      'bangalore': [12.9716, 77.5946]
    };
    const key = (name || '').toLowerCase().trim();
    return coords[key] || [39.5 + (key.length % 10) * 0.5, -98 + (key.length % 15)];
  }

  async function renderMap(source, destination) {
    const container = document.getElementById('map');
    if (!container) return;
    const renderToken = ++mapRenderToken;
    container.innerHTML = '';
    if (!source || !destination) {
      container.innerHTML = '<div class="section-empty">Add both cities to load the route map.</div>';
      return;
    }

    if (!googleMapsApiKey) {
      renderGoogleMapsFallback(
        container,
        source,
        destination,
        'Google Maps needs a valid GOOGLE_MAPS_API_KEY for the full interactive route map and Places suggestions.'
      );
      return;
    }

    if (!(window.google && window.google.maps)) {
      renderGoogleMapsFallback(
        container,
        source,
        destination,
        'Loading Google Maps. If this keeps failing, enable Maps JavaScript API, Places API, and billing on the key.'
      );
      try {
        await loadGoogleMapsScript(googleMapsApiKey);
      } catch (_) {
        if (renderToken != mapRenderToken) return;
        renderGoogleMapsFallback(
          container,
          source,
          destination,
          'Google Maps could not be loaded. Check key restrictions, enabled APIs, and billing.'
        );
        return;
      }
      if (renderToken != mapRenderToken) return;
      if (!(window.google && window.google.maps)) {
        renderGoogleMapsFallback(
          container,
          source,
          destination,
          'Google Maps is unavailable right now. Check key restrictions, enabled APIs, and billing.'
        );
        return;
      }
    }

    const [googleSrc, googleDst] = await Promise.all([
      geocodeGoogleAddress(source),
      geocodeGoogleAddress(destination)
    ]);
    if (renderToken != mapRenderToken) return;

    if (!googleSrc || !googleDst) {
      renderGoogleMapsFallback(
        container,
        source,
        destination,
        'Google Maps could not place one of these cities precisely, so a direct preview is shown instead.'
      );
      return;
    }

    const src = googleSrc;
    const dst = googleDst;
    const center = { lat: (src.lat + dst.lat) / 2, lng: (src.lng + dst.lng) / 2 };
    googleMapsReady = true;
    googleMapInstance = new google.maps.Map(container, {
      zoom: 5,
      center,
      mapTypeId: 'roadmap'
    });
    new google.maps.Marker({ position: src, map: googleMapInstance, title: source });
    new google.maps.Marker({ position: dst, map: googleMapInstance, title: destination });
    new google.maps.Polyline({
      path: [src, dst],
      strokeColor: '#3b82f6',
      strokeWeight: 3,
      geodesic: true,
      map: googleMapInstance
    });
    const bounds = new google.maps.LatLngBounds(
      new google.maps.LatLng(src.lat, src.lng),
      new google.maps.LatLng(dst.lat, dst.lng)
    );
    googleMapInstance.fitBounds(bounds, 40);
  }

  function loadRealTimeFlights(options) {
    const section = document.getElementById('realTimeFlightsSection');
    const list = document.getElementById('realTimeFlightsList');
    if (!section || !list) return;
    flightRealtimeOptions = (options || []).filter((option) => option.from_api);
    section.classList.add('hidden');
    list.innerHTML = '';
  }

  async function loadFuelCostIfCar(options, transportChoice) {
    const section = document.getElementById('fuelCostSection');
    const details = document.getElementById('fuelCostDetails');
    if (!section || !details) return;
    if (!transportChoice || !transportChoice.includes('car')) {
      section.classList.add('hidden');
      return;
    }
    const carOpt = (options || []).find(o => (o.modes || []).includes('car'));
    const distanceKm = carOpt && (carOpt.total_distance_km != null ? carOpt.total_distance_km : (carOpt.legs || []).reduce((s, l) => s + (l.distance_km || 0), 0)) || 0;
    section.classList.remove('hidden');
    details.innerHTML = '<p class="loading">Loading fuel price...</p>';
    try {
      const data = await fetchJSON(API + '/fuel?country=IN');
      const petrolPerL = data.petrol != null ? data.petrol : 105;
      const kmPerL = 12;
      const litersNeeded = distanceKm / kmPerL;
      const fuelCost = Math.round(litersNeeded * petrolPerL * 100) / 100;
      details.innerHTML = `
        <p><strong>Petrol price (real-time):</strong> INR ${petrolPerL.toFixed(2)}/L ${data.simulated ? '(est.)' : ''}</p>
        <p><strong>Distance:</strong> ${distanceKm.toFixed(0)} km | <strong>Est. fuel (${kmPerL} km/L):</strong> ${litersNeeded.toFixed(1)} L</p>
        <p><strong>Est. fuel cost:</strong> INR ${fuelCost.toFixed(2)}</p>
      `;
    } catch (_) {
      details.innerHTML = '<div class="section-empty">Could not load fuel price. Using fallback estimate: INR 105/L.</div>';
    }
  }

  function updateSelectedEventsCount() {
    const pill = document.getElementById('eventsSelectedCount');
    if (!pill) return;
    const count = selectedDestinationEvents.length;
    pill.textContent = `${count} selected`;
    pill.classList.toggle('hidden', count === 0);
  }

  function resetGeneratedItinerary() {
    if (!planState) return;
    planState.itinerary = null;
    if (typeof itineraryTimeline !== 'undefined' && itineraryTimeline) itineraryTimeline.innerHTML = '';
    if (typeof itinerarySection !== 'undefined' && itinerarySection) itinerarySection.classList.add('hidden');
  }

  function toggleSelectedDestinationEvent(eventId) {
    const normalizedId = String(eventId || '');
    if (!normalizedId) return;

    const existing = selectedDestinationEvents.find((event) => String(event.id) === normalizedId);
    if (existing) {
      selectedDestinationEvents = selectedDestinationEvents.filter((event) => String(event.id) !== normalizedId);
    } else {
      const picked = destinationEvents.find((event) => String(event.id) === normalizedId);
      if (picked) selectedDestinationEvents = [...selectedDestinationEvents, { ...picked }];
    }

    syncPlanSelectedEvents();
    resetGeneratedItinerary();
    renderDestinationEvents();
    updateSelectedEventsCount();
  }

  function renderDestinationEvents() {
    const list = document.getElementById('eventsList');
    if (!list) return;

    if (!destinationEvents.length) {
      list.innerHTML = '<div class="section-empty">No local events found for this city right now.</div>';
      updateSelectedEventsCount();
      return;
    }

    const selectedIds = new Set(selectedDestinationEvents.map((event) => String(event.id)));
    list.innerHTML = destinationEvents.map((event) => {
      const isSelected = selectedIds.has(String(event.id));
      const timing = event.when || event.date || 'Date TBA';
      const description = event.description
        ? `<p>${escapeHtml(event.description)}</p>`
        : '';
      const linkHtml = event.link
        ? `<a href="${escapeHtml(event.link)}" target="_blank" rel="noreferrer" class="btn btn-secondary">Open event</a>`
        : '';

      return `
        <div class="event-card ${isSelected ? 'selected' : ''}">
          <div class="event-card-head">
            <div>
              <strong>${escapeHtml(event.name)}</strong>
              <div class="event-card-meta">
                <span>${escapeHtml(event.venue || 'Venue TBA')}</span>
                <span>${escapeHtml(timing)}</span>
              </div>
            </div>
            <span class="event-badge">${escapeHtml(event.type || 'Event')}</span>
          </div>
          ${description}
          <div class="event-card-actions">
            ${linkHtml}
            <button type="button" class="btn ${isSelected ? 'btn-primary' : 'btn-ghost'}" data-event-toggle="${escapeHtml(event.id)}">${isSelected ? 'Selected' : 'Add to trip'}</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-event-toggle]').forEach((button) => {
      button.addEventListener('click', () => toggleSelectedDestinationEvent(button.dataset.eventToggle));
    });

    updateSelectedEventsCount();
  }

  async function loadEvents(destination, travelDate = null) {
    const list = document.getElementById('eventsList');
    if (!list) return;

    const queryKey = `${String(destination || '').trim().toLowerCase()}|${travelDate || ''}`;
    list.innerHTML = '<p class="loading">Loading local events...</p>';

    try {
      const params = new URLSearchParams({ city: destination });
      if (travelDate) params.set('travel_date', travelDate);
      const { events } = await fetchJSON(API + '/events?' + params.toString());
      const previousSelectedIds = new Set(selectedDestinationEvents.map((event) => String(event.id)));
      destinationEvents = Array.isArray(events) ? events : [];
      selectedDestinationEvents = destinationEventsKey === queryKey
        ? destinationEvents.filter((event) => previousSelectedIds.has(String(event.id))).map((event) => ({ ...event }))
        : [];
      destinationEventsKey = queryKey;
      syncPlanSelectedEvents();
      renderDestinationEvents();
    } catch (_) {
      destinationEvents = [];
      selectedDestinationEvents = [];
      destinationEventsKey = queryKey;
      syncPlanSelectedEvents();
      list.innerHTML = '<div class="section-empty">Could not load destination events at the moment.</div>';
      updateSelectedEventsCount();
    }
  }

  async function loadHistory() {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    try {
      const { history } = await fetchJSON(API + '/history');
      if (!history || history.length === 0) {
        list.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        return;
      }
      if (empty) empty.classList.add('hidden');
      list.innerHTML = history.map(h => `
        <div class="history-item">
          <div class="route">${escapeHtml(h.source)} -> ${escapeHtml(h.destination)}</div>
          <div class="meta">
            ${escapeHtml(h.start_date || '')}
            ${h.distance_km != null ? ' | ' + Number(h.distance_km).toFixed(0) + ' km' : ''}
            ${h.duration_minutes != null ? ' | ' + Math.floor(Number(h.duration_minutes) / 60) + 'h' : ''}
            ${h.estimated_cost != null ? ' | INR ' + Number(h.estimated_cost).toFixed(2) : ''}
          </div>
          <div class="meta">
            ${h.source_type === 'booking' ? 'Booked trip' : 'Saved trip'}
            ${h.status ? ' | ' + escapeHtml(String(h.status)) : ''}
            ${Array.isArray(h.modes) && h.modes.length ? ' | ' + escapeHtml(h.modes.join(' -> ')) : ''}
          </div>
        </div>
      `).join('');
    } catch (_) {
      list.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      if (empty) empty.textContent = 'Could not load history right now. Please refresh and try again.';
    }
  }

  // City autocomplete (source/destination/hero search)
  const CITY_SUGGESTIONS = [
    'Delhi',
    'Mumbai',
    'Bangalore',
    'Chennai',
    'Hyderabad',
    'Kolkata',
    'Pune',
    'Ahmedabad',
    'Jaipur',
    'Goa',
    'New York',
    'Los Angeles',
    'Chicago',
    'Miami',
    'Boston',
    'San Francisco',
    'Las Vegas',
    'London',
    'Paris',
    'Singapore',
    'Dubai'
  ];

  function fallbackLocationSuggestions(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return CITY_SUGGESTIONS
      .filter((city) => city.toLowerCase().includes(q))
      .slice(0, 8)
      .map((city, index) => {
        const country = inferCountryFromLocation(city, '');
        return {
          id: `fallback-${index + 1}`,
          label: city,
          description: country || 'Suggested city',
          type: 'city',
          location_id: '',
          airport_id: '',
          place_id: '',
          country: country || '',
          country_code: inferCountryCode(country)
        };
      });
  }

  function getGooglePlacesService() {
    if (!(window.google && window.google.maps && window.google.maps.places && window.google.maps.places.AutocompleteService)) return null;
    if (!getGooglePlacesService.instance) getGooglePlacesService.instance = new window.google.maps.places.AutocompleteService();
    return getGooglePlacesService.instance;
  }

  async function fetchGooglePlaceSuggestions(query) {
    const service = getGooglePlacesService();
    if (!service) return [];
    return new Promise((resolve) => {
      const finish = (predictions, status, relaxed = false) => {
        const ok = status === 'OK' || status === window.google?.maps?.places?.PlacesServiceStatus?.OK;
        if ((!ok || !Array.isArray(predictions) || !predictions.length) && !relaxed) {
          service.getPlacePredictions({ input: query }, (fallbackPredictions, fallbackStatus) => finish(fallbackPredictions, fallbackStatus, true));
          return;
        }
        if (!ok || !Array.isArray(predictions) || !predictions.length) {
          resolve([]);
          return;
        }
        resolve(predictions.slice(0, 8).map((prediction, index) => {
          const label = prediction.description || prediction.structured_formatting?.main_text || query;
          const description = prediction.structured_formatting?.secondary_text || 'Google Places';
          const country = inferCountryFromLocation(label, description);
          return {
            id: prediction.place_id || `google-${index + 1}`,
            label,
            description,
            type: 'city',
            location_id: '',
            airport_id: '',
            place_id: prediction.place_id || '',
            country: country || '',
            country_code: inferCountryCode(country)
          };
        }));
      };
      service.getPlacePredictions({ input: query, types: ['(cities)'] }, (predictions, status) => finish(predictions, status, false));
    });
  }

  async function fetchServerLocationSuggestions(query) {
    const q = String(query || '').trim();
    if (!q || q.length < 2) return [];
    const cacheKey = q.toLowerCase();
    if (autocompleteCache.has(cacheKey)) return autocompleteCache.get(cacheKey);
    try {
      const data = await fetchJSON(API + '/maps/autocomplete?q=' + encodeURIComponent(q));
      const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).map((item, index) => {
        const label = item.label || item.city || q;
        const description = item.description || item.airports?.map((airport) => airport.id).filter(Boolean).slice(0, 2).join(', ') || 'Flight search location';
        const country = normalizeCountryName(item.country || '') || inferCountryFromLocation(label, description);
        return {
          id: item.id || `server-${index + 1}`,
          label,
          description,
          type: item.type || 'city',
          location_id: item.location_id || '',
          airport_id: item.airport_id || '',
          place_id: '',
          country: country || '',
          country_code: item.country_code || inferCountryCode(country)
        };
      });
      autocompleteCache.set(cacheKey, suggestions);
      return suggestions;
    } catch (_) {
      return [];
    }
  }

  async function fetchLocationSuggestions(query) {
    const googleSuggestions = await fetchGooglePlaceSuggestions(query);
    if (googleSuggestions.length) return googleSuggestions;
    const serverSuggestions = await fetchServerLocationSuggestions(query);
    if (serverSuggestions.length) return serverSuggestions;
    return fallbackLocationSuggestions(query);
  }

  async function ensureInputLocationData(inputEl) {
    if (!inputEl || !inputEl.value?.trim()) return null;
    if (getInputLocationId(inputEl) || inputEl.dataset.country) {
      return {
        location_id: inputEl.dataset.locationId || '',
        airport_id: inputEl.dataset.airportId || '',
        country: getInputCountry(inputEl) || ''
      };
    }
    const typedValue = inputEl.value.trim();
    const serverSuggestions = await fetchServerLocationSuggestions(typedValue);
    if (!serverSuggestions.length) {
      const inferredCountry = inferCountryFromLocation(typedValue, '');
      if (inferredCountry) {
        inputEl.dataset.country = inferredCountry;
        inputEl.dataset.countryCode = inferCountryCode(inferredCountry);
      }
      return null;
    }
    const lowered = typedValue.toLowerCase();
    const picked = serverSuggestions.find((item) => {
      const label = (item.label || '').toLowerCase();
      return label === lowered || label.startsWith(lowered) || lowered.startsWith(label);
    }) || serverSuggestions[0];
    applyInputLocationSuggestion(inputEl, picked, true);
    return picked;
  }

  function attachCityAutocomplete(inputEl) {
    if (!inputEl) return;
    if (inputEl.dataset.autocompleteAttached === '1') return;

    let parent = inputEl.closest('.autocomplete-wrap') || inputEl.closest('.form-row') || inputEl.parentElement;
    if (!parent) return;
    parent.classList.add('autocomplete-wrap');

    const listEl = document.createElement('div');
    listEl.className = 'city-suggest-list hidden';
    parent.appendChild(listEl);
    inputEl.dataset.autocompleteAttached = '1';

    let activeIndex = -1;
    let currentItems = [];
    let requestToken = 0;

    function hideList() {
      listEl.classList.add('hidden');
      listEl.innerHTML = '';
      activeIndex = -1;
      currentItems = [];
    }

    function chooseSuggestion(item) {
      if (!item) return;
      applyInputLocationSuggestion(inputEl, item);
      hideList();
      inputEl.dispatchEvent(new Event('change'));
    }

    function renderList(items) {
      currentItems = items;
      activeIndex = -1;
      if (!items.length) {
        hideList();
        return;
      }
      listEl.innerHTML = items.map((item) => `
        <button type="button" class="city-suggest-item">
          <strong>${escapeHtml(item.label || 'Suggested location')}</strong>
          <span>${escapeHtml(item.description || 'Travel suggestion')}</span>
        </button>
      `).join('');
      listEl.classList.remove('hidden');
      listEl.querySelectorAll('.city-suggest-item').forEach((btn, index) => {
        btn.addEventListener('mousedown', (event) => {
          event.preventDefault();
          chooseSuggestion(items[index]);
        });
      });
    }

    function updateActiveItem() {
      const buttons = listEl.querySelectorAll('.city-suggest-item');
      buttons.forEach((btn, index) => btn.classList.toggle('active', index === activeIndex));
    }

    async function updateSuggestions() {
      const q = inputEl.value.trim();
      clearInputLocationState(inputEl);
      if (q.length < 2) {
        hideList();
        return;
      }
      const token = ++requestToken;
      const items = await fetchLocationSuggestions(q);
      if (token !== requestToken) return;
      renderList(items);
    }

    inputEl.addEventListener('input', updateSuggestions);
    inputEl.addEventListener('focus', () => {
      if ((inputEl.value || '').trim().length >= 2) updateSuggestions();
    });
    inputEl.addEventListener('keydown', (event) => {
      if (listEl.classList.contains('hidden')) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex = Math.min(activeIndex + 1, currentItems.length - 1);
        updateActiveItem();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActiveItem();
      } else if (event.key === 'Enter' && activeIndex >= 0 && currentItems[activeIndex]) {
        event.preventDefault();
        chooseSuggestion(currentItems[activeIndex]);
      } else if (event.key === 'Escape') {
        hideList();
      }
    });
    inputEl.addEventListener('blur', () => {
      setTimeout(hideList, 120);
    });
  }

  function enableGooglePlacesAutocomplete() {}

  window.initGooglePlacesAutocomplete = function () {
    handleGoogleMapsReady();
  };

  window.gm_authFailure = function () {
    googleMapsReady = false;
    googleMapInstance = null;
    googleMapsLoadPromise = null;
    if (googleMapsLoadReject) {
      googleMapsLoadReject(new Error('Google Maps authentication failed'));
      googleMapsLoadResolve = null;
      googleMapsLoadReject = null;
    }
    notify('Google Maps rejected the API key. Check billing and enabled APIs.', 'error');
    const activeTrip = planState || lastPlanData;
    if (activeTrip?.source && activeTrip?.destination) {
      renderMap(activeTrip.source, activeTrip.destination);
    }
  };

  // Hero Search Logic
  const heroWhereForm = document.getElementById('heroWhereForm');
  const heroSearchBtn = document.getElementById('heroSearchBtn');
  const heroSearchInput = document.getElementById('heroSearchInput');
  const heroSourceInput = document.getElementById('heroSourceInput');
  const heroDateInput = document.getElementById('heroDateInput');
  const heroReturnDateInput = document.getElementById('heroReturnDateInput');
  const heroOpenPlanner = document.getElementById('heroOpenPlanner');

  attachCityAutocomplete(document.getElementById('planSource'));
  attachCityAutocomplete(document.getElementById('planDestination'));
  attachCityAutocomplete(heroSearchInput);
  attachCityAutocomplete(heroSourceInput);

  function launchPlannerFromHero() {
    const planDestination = document.getElementById('planDestination');
    const planSource = document.getElementById('planSource');
    const planDate = document.getElementById('planTravelDate');
    const planReturnDate = document.getElementById('planReturnDate');
    const tripError = getTripValidationMessage(heroDateInput?.value || '', heroReturnDateInput?.value || '');

    if (tripError) {
      notify(tripError, 'error');
      return;
    }

    showPage('plan');
    if (heroSearchInput && planDestination) copyInputLocationState(heroSearchInput, planDestination);
    if (heroSourceInput && planSource) copyInputLocationState(heroSourceInput, planSource);
    if (planDate) planDate.value = heroDateInput?.value || '';
    if (planReturnDate) planReturnDate.value = heroReturnDateInput?.value || '';
    syncPlannerTripInputs();
    document.getElementById('wizardStep1')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  [heroDateInput, heroReturnDateInput].forEach((inputEl) => {
    inputEl?.addEventListener('change', syncHeroTripInputs);
    inputEl?.addEventListener('input', syncHeroTripInputs);
  });
  [document.getElementById('planTravelDate'), document.getElementById('planReturnDate')].forEach((inputEl) => {
    inputEl?.addEventListener('input', syncPlannerTripInputs);
  });
  const todayDateValue = getTodayDateValue();
  if (heroDateInput) heroDateInput.min = todayDateValue;
  if (heroReturnDateInput) heroReturnDateInput.min = todayDateValue;
  const plannerTravelDateInput = document.getElementById('planTravelDate');
  const plannerReturnDateInput = document.getElementById('planReturnDate');
  if (plannerTravelDateInput) plannerTravelDateInput.min = todayDateValue;
  if (plannerReturnDateInput) plannerReturnDateInput.min = todayDateValue;
  syncHeroTripInputs();
  syncPlannerTripInputs();

  if (heroWhereForm) {
    heroWhereForm.addEventListener('submit', (event) => {
      event.preventDefault();
      launchPlannerFromHero();
    });
  }

  if (heroSearchInput) {
    heroSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        launchPlannerFromHero();
      }
    });
  }

  if (heroSearchBtn) {
    heroSearchBtn.addEventListener('click', (event) => {
      event.preventDefault();
      launchPlannerFromHero();
    });
  }

  if (heroOpenPlanner) {
    heroOpenPlanner.addEventListener('click', () => {
      showPage('plan');
      syncPlannerTripInputs();
    });
  }

async function loadPreferences() {
    try {
      const p = await fetchJSON(API + '/preferences');
      document.querySelectorAll('#formPreferences input[name="mode"]').forEach(cb => {
        cb.checked = (p.preferred_modes || []).includes(cb.value);
      });
      const min = document.getElementById('prefBudgetMin');
      const max = document.getElementById('prefBudgetMax');
      if (min) min.value = p.budget_min ?? '';
      if (max) max.value = p.budget_max ?? '';
    } catch (_) { }
  }

  document.getElementById('formPreferences')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const saveBtn = form.querySelector('button[type="submit"]');
    const preferred_modes = Array.from(form.querySelectorAll('input[name="mode"]:checked')).map(c => c.value);
    const budget_min = form.budget_min?.value ? parseFloat(form.budget_min.value) : null;
    const budget_max = form.budget_max?.value ? parseFloat(form.budget_max.value) : null;
    try {
      setButtonLoading(saveBtn, 'Saving...', true);
      await fetchJSON(API + '/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferred_modes, budget_min, budget_max })
      });
      notify('Preferences saved.', 'success');
    } catch (err) {
      notify(err.message || 'Failed to save preferences', 'error');
    } finally {
      setButtonLoading(saveBtn, '', false);
    }
  });

  // Settings Logic
  const settingsModal = document.getElementById('settingsModal');
  const navSettings = document.getElementById('navSettings');
  const closeSettings = document.getElementById('closeSettings');
  const formSettings = document.getElementById('formSettings');

  if (navSettings) {
    navSettings.addEventListener('click', (e) => {
      e.preventDefault();
      if (settingsModal) settingsModal.classList.remove('hidden');
    });
  }

  if (closeSettings) {
    closeSettings.addEventListener('click', () => {
      if (settingsModal) settingsModal.classList.add('hidden');
    });
  }

  if (formSettings) {
    formSettings.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = formSettings.querySelector('button[type="submit"]');
      const serpApiKey = formSettings.serpApiKey.value.trim();
      const rapidApiKey = formSettings.rapidApiKey.value.trim();
      const googleMapsApiKey = formSettings.googleMapsApiKey.value.trim();

      if (!serpApiKey && !rapidApiKey && !googleMapsApiKey) return;

      try {
      setButtonLoading(saveBtn, 'Saving...', true);
        await fetchJSON(API + '/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serpApiKey, rapidApiKey, googleMapsApiKey })
        });
        notify('Settings saved. Reloading...', 'success');
        window.location.reload();
      } catch (err) {
        notify('Failed to save settings.', 'error');
      } finally {
        setButtonLoading(saveBtn, '', false);
      }
    });
  }

  // Itinerary Logic
  const itineraryModal = document.getElementById('itineraryModal');
  const formItinerary = document.getElementById('formItinerary');
  const itinerarySection = document.getElementById('itinerarySection');
  const itineraryTimeline = document.getElementById('itineraryTimeline');
  const closeItinerary = document.getElementById('closeItinerary');
  const btnRecalculateItinerary = document.getElementById('btnRecalculateItinerary');

  function showItineraryModal() {
    if (formItinerary) {
      const daysInput = formItinerary.querySelector('input[name="days"]');
      const metrics = getTripMetrics(planState?.travel_date, planState?.return_date);
      const suggestedDays = Math.max(1, planState?.trip_days || metrics.days || safeNum(daysInput?.value, 3) || 3);
      if (daysInput) daysInput.value = String(suggestedDays);
    }
    if (itineraryModal) itineraryModal.classList.remove('hidden');
  }

  if (closeItinerary) {
    closeItinerary.addEventListener('click', () => {
      if (itineraryModal) itineraryModal.classList.add('hidden');
    });
  }

  if (btnRecalculateItinerary) {
    btnRecalculateItinerary.addEventListener('click', showItineraryModal);
  }

  // Generate itinerary from modal form
  if (formItinerary) {
    formItinerary.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formItinerary);
      const days = Math.max(1, parseInt(fd.get('days') || '3', 10) || 3);
      const interests = Array.from(fd.getAll('interest'));
      const destination = planState?.destination;
      const submitBtn = formItinerary.querySelector('button[type="submit"]');

      if (!destination) {
        notify('Please select a destination first.', 'error');
        return;
      }
      if (!submitBtn) return;

      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Generating...';
      submitBtn.disabled = true;

      try {
        syncPlanSelectedEvents();
        const { itinerary } = await fetchJSON(API + '/travel/itinerary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination,
            days,
            interests,
            selected_events: planState?.selected_events || [],
            context: `Budget: ${planState?.budget}, Style: ${planState?.preference_type}`
          })
        });

        planState.itinerary = itinerary;
        renderItinerary(itinerary);
        if (itineraryModal) itineraryModal.classList.add('hidden');
        showPage('review');
        renderReviewSummary();
      } catch (err) {
        notify('Failed to generate itinerary: ' + err.message, 'error');
      } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    });
  }

  function renderItinerary(itinerary) {
    if (!itineraryTimeline) return;
    if (itinerarySection) itinerarySection.classList.remove('hidden');
    itineraryTimeline.innerHTML = itinerary.map((day) => `
      <div class="day-plan">
        <div class="day-header">Day ${escapeHtml(day.day)}</div>
        ${(Array.isArray(day.activities) ? day.activities : []).map((activity) => `
          <div class="activity-item">
            <span class="activity-time">${escapeHtml(activity.time || 'TBA')}</span>
            <div class="activity-content">
              <span class="activity-title">${escapeHtml(activity.title || 'Planned activity')}</span>
              <span class="activity-tag">${escapeHtml(activity.type || 'activity')}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  // Hook into flight selection to trigger itinerary with selected option context.
  window.selectFlight = function (index) {
    const original = flightRealtimeOptions[Number(index)];
    const opt = original ? { ...original } : null;
    if (!opt || !lastPlanData) {
      notify('Please generate route options first.', 'error');
      return;
    }
    const selectedHotelDetails = selectedHotelForPricing() || lastPlanData.selected_hotel || null;
    if (selectedHotelDetails) {
      const current = opt.total_cost != null ? safeNum(opt.total_cost, 0) : safeNum(opt.total_with_hotel, 0);
      const existingHotelCost = opt.hotel && opt.hotel.total_cost != null ? safeNum(opt.hotel.total_cost, 0) : 0;
      const transportOnly = Math.max(0, current - existingHotelCost);
      opt.hotel = selectedHotelDetails;
      opt.total_cost = transportOnly + safeNum(selectedHotelDetails.total_cost, 0);
      opt.total_with_hotel = opt.total_cost;
    }
    planState = {
      source: lastPlanData.source,
      destination: lastPlanData.destination,
      travel_date: lastPlanData.travel_date || null,
      return_date: lastPlanData.return_date || null,
      source_id: lastPlanData.source_id || null,
      destination_id: lastPlanData.destination_id || null,
      trip_days: lastPlanData.trip_days || null,
      trip_nights: lastPlanData.trip_nights ?? null,
      budget: lastPlanData.budget != null ? parseFloat(lastPlanData.budget) : null,
      preference_type: lastPlanData.preference_type || null,
      num_travelers: parseInt(lastPlanData.num_travelers, 10) || 1,
      selected_option: opt,
      selected_events: getSelectedEventsForPlan()
    };
    showItineraryModal();
  };

  (async function initConfig() {
    try {
      const config = await fetchJSON(API + '/config');
      if (config.googleMapsApiKey) {
        googleMapsApiKey = config.googleMapsApiKey;
        loadGoogleMapsScript(config.googleMapsApiKey).catch(() => { });
      }
    } catch (_) { }
  })();

  checkAuth().then(user => {
    if (user) {
      showPage('plan');
      return;
    }
    redirectToLogin();
  });
})();














