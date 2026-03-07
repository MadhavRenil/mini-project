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
  const autocompleteCache = new Map();

  function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.add('active');
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

  function getTripMetrics(departureDate, returnDate) {
    if (!departureDate && !returnDate) return { state: 'empty', days: null, nights: null, label: 'Choose travel dates', invalid: false };
    if (!departureDate) return { state: 'invalid', days: null, nights: null, label: 'Add a departure date first', invalid: true };
    if (!returnDate) return { state: 'oneway', days: null, nights: null, label: 'One-way trip', invalid: false };
    const start = parseDateOnly(departureDate);
    const end = parseDateOnly(returnDate);
    if (!start || !end) return { state: 'invalid', days: null, nights: null, label: 'Check your travel dates', invalid: true };
    const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
    if (diff < 0) return { state: 'invalid', days: null, nights: null, label: 'Return date must be after departure', invalid: true };
    const days = diff + 1;
    const nights = diff;
    return { state: 'roundtrip', days, nights, label: `${days} day${days === 1 ? '' : 's'} ? ${nights} night${nights === 1 ? '' : 's'}`, invalid: false };
  }

  function getTripLengthLabel(days, nights) {
    if (!Number.isFinite(days) || days < 1) return '';
    const safeNights = Number.isFinite(nights) ? Math.max(0, nights) : Math.max(0, days - 1);
    return `${days} day${days === 1 ? '' : 's'} ? ${safeNights} night${safeNights === 1 ? '' : 's'}`;
  }

  function getTripDateLine(departureDate, returnDate) {
    if (!departureDate) return 'Travel dates: TBD';
    if (!returnDate) return `Departure: ${departureDate} ? One-way`;
    const metrics = getTripMetrics(departureDate, returnDate);
    if (metrics.invalid) return `Departure: ${departureDate} ? Return: ${returnDate}`;
    return `Departure: ${departureDate} ? Return: ${returnDate} ? ${getTripLengthLabel(metrics.days, metrics.nights)}`;
  }

  function getTripValidationMessage(departureDate, returnDate) {
    if (!departureDate) return 'Please choose a departure date.';
    const metrics = getTripMetrics(departureDate, returnDate);
    if (metrics.invalid) return 'Return date must be on or after the departure date.';
    return '';
  }

  function clearInputLocationState(inputEl) {
    if (!inputEl) return;
    delete inputEl.dataset.locationId;
    delete inputEl.dataset.airportId;
    delete inputEl.dataset.placeId;
    delete inputEl.dataset.selectedLabel;
  }

  function applyInputLocationSuggestion(inputEl, suggestion, keepCurrentValue = false) {
    if (!inputEl || !suggestion) return;
    if (!keepCurrentValue && suggestion.label) inputEl.value = suggestion.label;
    inputEl.dataset.locationId = suggestion.location_id || '';
    inputEl.dataset.airportId = suggestion.airport_id || '';
    inputEl.dataset.placeId = suggestion.place_id || '';
    inputEl.dataset.selectedLabel = suggestion.label || inputEl.value || '';
  }

  function copyInputLocationState(sourceInput, targetInput) {
    if (!sourceInput || !targetInput) return;
    targetInput.value = sourceInput.value || '';
    applyInputLocationSuggestion(targetInput, { label: sourceInput.value || '', location_id: sourceInput.dataset.locationId || '', airport_id: sourceInput.dataset.airportId || '', place_id: sourceInput.dataset.placeId || '' }, true);
    if (!sourceInput.dataset.locationId && !sourceInput.dataset.airportId && !sourceInput.dataset.placeId) clearInputLocationState(targetInput);
  }

  function getInputLocationId(inputEl) {
    if (!inputEl) return '';
    return inputEl.dataset.locationId || inputEl.dataset.airportId || '';
  }

  function syncTripLengthDisplay(departureInput, returnInput, pill, nightsInput = null) {
    const departureDate = departureInput?.value || '';
    const returnDate = returnInput?.value || '';
    if (returnInput) returnInput.min = departureDate || '';
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

  function selectedHotelForPricing() {
    if (!selectedHotel) return null;
    const nights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    const hotelType = document.querySelector('input[name="hotel_type"]:checked')?.value || selectedHotel.category || 'midrange';
    return {
      id: selectedHotel.id || null,
      type: hotelType,
      name: selectedHotel.name || 'Selected Hotel',
      price_per_night: Math.max(0, safeNum(selectedHotel.price, 0)),
      total_nights: nights,
      total_cost: Math.max(0, safeNum(selectedHotel.price, 0)) * nights,
      rating: selectedHotel.rating != null ? safeNum(selectedHotel.rating, null) : null,
      simulated: !!selectedHotel.simulated,
      source: selectedHotel.source || (selectedHotel.simulated ? 'simulated' : 'api'),
      distance_to_center_km: selectedHotel.distance_to_center_km != null ? safeNum(selectedHotel.distance_to_center_km, null) : null,
      distance_to_airport_km: selectedHotel.distance_to_airport_km != null ? safeNum(selectedHotel.distance_to_airport_km, null) : null,
      cancellation: selectedHotel.cancellation || null,
      payment: selectedHotel.payment || null
    };
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

  function updateSelectedHotelSummary() {
    const box = document.getElementById('selectedHotelSummary');
    if (!box) return;
    if (!selectedHotel) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const nights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    const nightly = Math.max(0, safeNum(selectedHotel.price, 0));
    const total = nightly * nights;
    const rating = selectedHotel.rating != null ? `${safeNum(selectedHotel.rating).toFixed(1)}/10` : 'No rating';
    const center = selectedHotel.distance_to_center_km != null ? ` · ${safeNum(selectedHotel.distance_to_center_km).toFixed(1)} km to center` : '';
    box.classList.remove('hidden');
    box.innerHTML = `<strong>Selected stay:</strong> ${selectedHotel.name || 'Hotel'} · ₹${nightly.toLocaleString('en-IN')}/night · ${nights} night(s) = ₹${total.toLocaleString('en-IN')} · ${rating}${center}`;
  }

  function renderHotelsStepList() {
    const list = document.getElementById('wizardHotelsList');
    if (!list) return;
    const maxPrice = safeNum(document.getElementById('hotelMaxPrice')?.value, 0);
    const minRating = safeNum(document.getElementById('hotelMinRating')?.value, 0);
    const sortBy = document.getElementById('hotelSortBy')?.value || 'price_asc';
    const nights = Math.max(1, parseInt(document.getElementById('planHotelNights')?.value, 10) || 2);
    const hotelType = document.querySelector('input[name="hotel_type"]:checked')?.value || 'midrange';

    let hotels = (hotelRealtimeOptions || []).filter((h) => {
      const priceOk = !maxPrice || safeNum(h.price, 0) <= maxPrice;
      const ratingVal = h.rating != null ? safeNum(h.rating, 0) : 0;
      const ratingOk = !minRating || ratingVal >= minRating;
      const typeOk = !hotelType || !h.category || h.category === hotelType;
      return priceOk && ratingOk && typeOk;
    });

    hotels = hotels.sort((a, b) => {
      if (sortBy === 'price_desc') return safeNum(b.price, 0) - safeNum(a.price, 0);
      if (sortBy === 'rating_desc') return safeNum(b.rating, 0) - safeNum(a.rating, 0);
      return safeNum(a.price, 0) - safeNum(b.price, 0);
    });

    if (!hotels.length) {
      list.innerHTML = '<div class="section-empty">No hotels match your filters. Try widening price/rating filters.</div>';
      return;
    }

    list.innerHTML = hotels.map((h, idx) => {
      const id = h.id || `hotel-${idx}`;
      const price = Math.max(0, safeNum(h.price, 0));
      const rating = h.rating != null ? `${safeNum(h.rating, 0).toFixed(1)}/10` : 'No rating';
      const total = price * nights;
      const isSelected = selectedHotel && (selectedHotel.id ? selectedHotel.id === id : selectedHotel.name === h.name);
      const distanceCenter = h.distance_to_center_km != null ? `${safeNum(h.distance_to_center_km, 0).toFixed(1)} km to center` : 'Center distance n/a';
      const distanceAirport = h.distance_to_airport_km != null ? `${safeNum(h.distance_to_airport_km, 0).toFixed(1)} km to airport` : 'Airport distance n/a';
      return `
        <div class="hotel-card card ${isSelected ? 'selected' : ''}" data-hotel-id="${id}">
          <div class="hotel-head">
            <strong>${h.name || 'Hotel'}</strong>
            <span class="hotel-price">₹${price.toLocaleString('en-IN')}${h.simulated ? '/night (est.)' : '/night'}</span>
          </div>
          <div class="hotel-meta">
            <span>${rating}</span>
            <span>Stay total: ₹${total.toLocaleString('en-IN')}</span>
            <span>${distanceCenter}</span>
            <span>${distanceAirport}</span>
          </div>
          <div class="hotel-tags">
            <span class="hotel-tag">${h.category || 'stay'}</span>
            <span class="hotel-tag">${h.cancellation || 'Cancellation info unavailable'}</span>
            <span class="hotel-tag">${h.payment || 'Payment info unavailable'}</span>
          </div>
          <div class="hotel-actions">
            <button type="button" class="btn ${isSelected ? 'btn-selected' : 'btn-ghost'} btn-pick-hotel" data-hotel-id="${id}">
              ${isSelected ? 'Selected' : 'Select this hotel'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.btn-pick-hotel').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hotelId = btn.getAttribute('data-hotel-id');
        const picked = hotelRealtimeOptions.find(h => String(h.id || '') === String(hotelId)) || null;
        if (!picked) return;
        selectedHotel = { ...picked };
        updateSelectedHotelSummary();
        renderHotelsStepList();
      });
    });
  }

  async function refreshStayHotels(forceReload = false) {
    const list = document.getElementById('wizardHotelsList');
    if (!list) return;
    const stay = getStayInputs();
    if (!stay.destination) {
      list.innerHTML = '<div class="section-empty">Enter destination in Step 1 to load hotel options.</div>';
      return;
    }
    const fetchKey = `${stay.destination}|${stay.checkin}|${stay.checkout}|${stay.adults}|${stay.hotelType}`;
    if (!forceReload && hotelRealtimeOptions.length && hotelFetchKey === fetchKey) {
      renderHotelsStepList();
      return;
    }
    hotelFetchKey = fetchKey;
    list.innerHTML = '<p class="loading">Loading hotel prices…</p>';
    try {
      const q = new URLSearchParams({
        destination: stay.destination,
        checkin: stay.checkin,
        checkout: stay.checkout,
        adults: String(stay.adults),
        hotel_type: stay.hotelType
      });
      const data = await fetchJSON(API + '/hotels?' + q.toString());
      hotelRealtimeOptions = (data.hotels || []).map((h, i) => ({
        ...h,
        id: h.id || `hotel-${i + 1}`,
        category: h.category || (safeNum(h.price, 0) <= 1800 ? 'hostel' : safeNum(h.price, 0) <= 3200 ? 'budget' : safeNum(h.price, 0) <= 7000 ? 'midrange' : safeNum(h.price, 0) <= 9000 ? 'apartment' : 'luxury')
      }));
      if (selectedHotel) {
        const stillExists = hotelRealtimeOptions.find(h => String(h.id) === String(selectedHotel.id));
        if (!stillExists) selectedHotel = null;
      }
      renderHotelsStepList();
      updateSelectedHotelSummary();
    } catch (_) {
      list.innerHTML = '<div class="section-empty">Could not load hotel prices right now. Try again in a few seconds.</div>';
    }
  }

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
    document.querySelectorAll('.wizard-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('wizardStep' + step);
    if (panel) {
      panel.classList.add('active');
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const focusTarget = panel.querySelector('input, select, button');
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
  }

  function initPlanPage() {
    document.getElementById('planResults').classList.add('hidden');
    hotelRealtimeOptions = [];
    selectedHotel = null;
    hotelFetchKey = '';
    updateSelectedHotelSummary();
    syncPlannerTripInputs();
    showWizardStep(1);
  }

  document.getElementById('wizardNext1')?.addEventListener('click', () => {
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
    syncPlannerTripInputs();
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
  document.getElementById('wizardNext3')?.addEventListener('click', () => showWizardStep(4));
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
    if (document.getElementById('wizardStep3')?.classList.contains('active')) await refreshStayHotels(true);
  });
  const handlePlanDateChange = async () => {
    syncPlannerTripInputs();
    if (document.getElementById('wizardStep3')?.classList.contains('active')) await refreshStayHotels(true);
  };
  document.getElementById('planTravelDate')?.addEventListener('change', handlePlanDateChange);
  document.getElementById('planReturnDate')?.addEventListener('change', handlePlanDateChange);
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
      optionsWithSelectedHotel.forEach((opt, i) => {
        const card = document.createElement('div');
        card.className = 'option-card' + (i === 0 ? ' recommended' : '');
        const modes = (opt.modes || opt.legs?.map((l) => l.modeName || l.mode) || []);
        const modesText = modes.join(' -> ');
        const cost = opt.total_cost != null ? opt.total_cost : (opt.total_with_hotel != null ? opt.total_with_hotel : (opt.legs || []).reduce((sum, leg) => sum + (leg.estimated_cost || 0), 0));
        const duration = opt.total_duration_minutes != null ? opt.total_duration_minutes : (opt.legs || []).reduce((sum, leg) => sum + (leg.duration_minutes || 0), 0);
        const dist = opt.total_distance_km != null ? opt.total_distance_km : (opt.legs || []).reduce((sum, leg) => sum + (leg.distance_km || 0), 0);
        const hotel = opt.hotel;
        const hotelLine = hotel ? `Stay: ${escapeHtml(hotel.name)} (${hotel.total_nights} night${hotel.total_nights > 1 ? 's' : ''}) - INR ${safeNum(hotel.price_per_night, 0).toLocaleString('en-IN')}/night` : 'Stay details not available';
        const primaryCarrier = opt.carrier || (opt.legs && opt.legs[0] && opt.legs[0].modeName) || 'Multimodal';
        const refCode = opt.quote_id || opt.id || `OPT-${i + 1}`;
        const routeType = opt.direct !== false ? 'Direct' : '1 stop';
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
                <span class="option-g-sub">${escapeHtml(routeType)} - ${dist.toFixed(0)} km</span>
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
            <div class="option-g-price">INR ${(cost || 0).toFixed(2)}</div>
            <div class="option-g-price-sub">total trip estimate</div>
            <div class="option-actions">
              <button type="button" class="btn btn-primary btn-select-review" data-index="${i}">Select and review</button>
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
      optionsList.querySelectorAll('.btn-select-review').forEach((btn) => btn.addEventListener('click', () => goToReview(btn.closest('.option-card'))));
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
    const cost = opt.total_cost != null ? opt.total_cost : (opt.legs || []).reduce((s, l) => s + (l.estimated_cost || 0), 0);
    doc.text(`Total Cost: ${cost.toFixed(2)} INR`, 20, planState.trip_days ? (planState.return_date ? 62 : 56) : (planState.return_date ? 56 : 52));

    let y = planState.trip_days ? (planState.return_date ? 75 : 69) : (planState.return_date ? 69 : 65);
    doc.setFontSize(16);
    doc.text('Transport', 20, y);
    y += 10;
    doc.setFontSize(12);
    (opt.legs || []).forEach(leg => {
      doc.text(`- ${leg.modeName} (${leg.duration_minutes}m): ${leg.estimated_cost} INR`, 20, y);
      y += 8;
    });

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

  function renderReviewSummary() {
    const el = document.getElementById('reviewSummary');
    if (!el || !planState) return;
    syncPlanSelectedEvents();
    const opt = planState.selected_option;
    const cost = opt.total_cost != null ? opt.total_cost : (opt.total_with_hotel != null ? opt.total_with_hotel : (opt.legs || []).reduce((s, l) => s + (l.estimated_cost || 0), 0));
    const modes = (opt.modes || opt.legs?.map((leg) => leg.modeName || leg.mode) || []).join(' -> ');
    const hotelLine = opt.hotel
      ? `<div class="meta">Stay: ${escapeHtml(opt.hotel.name)} (${escapeHtml(opt.hotel.total_nights)} night(s)) | INR ${safeNum(opt.hotel.price_per_night, 0).toLocaleString('en-IN')}/night | Total INR ${safeNum(opt.hotel.total_cost, 0).toLocaleString('en-IN')}</div>`
      : '';
    const tripLengthLine = planState.trip_days ? `<div class="meta">Trip length: ${escapeHtml(getTripLengthLabel(planState.trip_days, planState.trip_nights))}</div>` : '';

    el.innerHTML = `
      <div class="route">${escapeHtml(planState.source)} -> ${escapeHtml(planState.destination)}</div>
      <div class="meta">${escapeHtml(getTripDateLine(planState.travel_date, planState.return_date))} | Travelers: ${escapeHtml(planState.num_travelers)}</div>
      ${tripLengthLine}
      <div class="meta">${escapeHtml(modes || 'Multimodal')}</div>
      ${hotelLine}
      <div class="meta" style="margin-top:0.5rem; font-weight:600;">Total: INR ${(cost || 0).toFixed(2)}</div>
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
    setButtonLoading(payBtn, 'Processing payment…', true);
    try {
      const pay = await fetchJSON(API + '/travel/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_number, expiry, cvv, name_on_card })
      });
      const opt = planState.selected_option;
      const total_cost = opt.total_cost != null ? opt.total_cost : (opt.legs || []).reduce((s, l) => s + (l.estimated_cost || 0), 0);
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
    const cost = opt.total_cost != null ? opt.total_cost : (opt.legs || []).reduce((s, l) => s + (l.estimated_cost || 0), 0);
    const selectedEvents = Array.isArray(planState.selected_events) ? planState.selected_events : [];
    const tripLengthLine = planState.trip_days ? `<div class="meta">Trip length: ${escapeHtml(getTripLengthLabel(planState.trip_days, planState.trip_nights))}</div>` : '';
    el.innerHTML = `
      <div class="route">${escapeHtml(planState.source)} -> ${escapeHtml(planState.destination)}</div>
      <div class="meta">${escapeHtml(getTripDateLine(planState.travel_date, planState.return_date))} | Travelers: ${escapeHtml(planState.num_travelers)}</div>
      ${tripLengthLine}
      <div class="meta">Total paid: INR ${cost.toFixed(2)}</div>
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
    const total_cost = opt.total_cost != null ? opt.total_cost : (opt.legs || []).reduce((s, l) => s + (l.estimated_cost || 0), 0);
    const total_duration = opt.total_duration_minutes != null ? opt.total_duration_minutes : (opt.legs || []).reduce((s, l) => s + (l.duration_minutes || 0), 0);
    const total_distance_km = opt.total_distance_km != null ? opt.total_distance_km : (opt.legs || []).reduce((s, l) => s + (l.distance_km || 0), 0);
    try {
      setButtonLoading(saveBtn, 'Saving…', true);
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
      loadGoogleMapsScript(googleMapsApiKey).catch(() => {
        renderGoogleMapsFallback(
          container,
          source,
          destination,
          'Google Maps could not be loaded. Check key restrictions, enabled APIs, and billing.'
        );
      });
      return;
    }

    const [googleSrc, googleDst] = await Promise.all([
      geocodeGoogleAddress(source),
      geocodeGoogleAddress(destination)
    ]);
    if (renderToken != mapRenderToken) return;

    const srcFallback = geocodeCity(source);
    const dstFallback = geocodeCity(destination);
    const src = googleSrc || { lat: srcFallback[0], lng: srcFallback[1] };
    const dst = googleDst || { lat: dstFallback[0], lng: dstFallback[1] };
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
    details.innerHTML = '<p class="loading">Loading fuel price…</p>';
    try {
      const data = await fetchJSON(API + '/fuel?country=IN');
      const petrolPerL = data.petrol != null ? data.petrol : 105;
      const kmPerL = 12;
      const litersNeeded = distanceKm / kmPerL;
      const fuelCost = Math.round(litersNeeded * petrolPerL * 100) / 100;
      details.innerHTML = `
        <p><strong>Petrol price (real-time):</strong> ₹${petrolPerL.toFixed(2)}/L ${data.simulated ? '(est.)' : ''}</p>
        <p><strong>Distance:</strong> ${distanceKm.toFixed(0)} km · <strong>Est. fuel (${kmPerL} km/L):</strong> ${litersNeeded.toFixed(1)} L</p>
        <p><strong>Est. fuel cost:</strong> ₹${fuelCost.toFixed(2)}</p>
      `;
    } catch (_) {
      details.innerHTML = '<div class="section-empty">Could not load fuel price. Using fallback estimate: ₹105/L.</div>';
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
            ${h.distance_km != null ? ' � ' + Number(h.distance_km).toFixed(0) + ' km' : ''}
            ${h.duration_minutes != null ? ' � ' + Math.floor(Number(h.duration_minutes) / 60) + 'h' : ''}
            ${h.estimated_cost != null ? ' � INR ' + Number(h.estimated_cost).toFixed(2) : ''}
          </div>
          <div class="meta">
            ${h.source_type === 'booking' ? 'Booked trip' : 'Saved trip'}
            ${h.status ? ' � ' + escapeHtml(String(h.status)) : ''}
            ${Array.isArray(h.modes) && h.modes.length ? ' � ' + escapeHtml(h.modes.join(' -> ')) : ''}
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
      .map((city, index) => ({
        id: `fallback-${index + 1}`,
        label: city,
        description: 'Suggested city',
        type: 'city',
        location_id: '',
        airport_id: '',
        place_id: ''
      }));
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
      service.getPlacePredictions({ input: query, types: ['(cities)'] }, (predictions, status) => {
        const ok = status === 'OK' || status === window.google?.maps?.places?.PlacesServiceStatus?.OK;
        if (!ok || !Array.isArray(predictions)) {
          resolve([]);
          return;
        }
        resolve(predictions.slice(0, 8).map((prediction, index) => ({
          id: prediction.place_id || `google-${index + 1}`,
          label: prediction.description || prediction.structured_formatting?.main_text || query,
          description: prediction.structured_formatting?.secondary_text || 'Google Places',
          type: 'city',
          location_id: '',
          airport_id: '',
          place_id: prediction.place_id || ''
        })));
      });
    });
  }

  async function fetchServerLocationSuggestions(query) {
    const q = String(query || '').trim();
    if (!q || q.length < 2) return [];
    const cacheKey = q.toLowerCase();
    if (autocompleteCache.has(cacheKey)) return autocompleteCache.get(cacheKey);
    try {
      const data = await fetchJSON(API + '/maps/autocomplete?q=' + encodeURIComponent(q));
      const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).map((item, index) => ({
        id: item.id || `server-${index + 1}`,
        label: item.label || item.city || q,
        description: item.description || item.airports?.map((airport) => airport.id).filter(Boolean).slice(0, 2).join(', ') || 'Flight search location',
        type: item.type || 'city',
        location_id: item.location_id || '',
        airport_id: item.airport_id || '',
        place_id: ''
      }));
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
    if (getInputLocationId(inputEl)) {
      return { location_id: inputEl.dataset.locationId || '', airport_id: inputEl.dataset.airportId || '' };
    }
    const typedValue = inputEl.value.trim();
    const serverSuggestions = await fetchServerLocationSuggestions(typedValue);
    if (!serverSuggestions.length) return null;
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
      setButtonLoading(saveBtn, 'Saving…', true);
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
        notify('Settings saved. Reloading…', 'success');
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




