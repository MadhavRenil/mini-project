const destinationData = require('./destinations');
const OpenAI = require('openai');

const GEMINI_MODEL = 'gemini-2.5-flash';
const EVENT_ACTIVITY_TIMES = ['5:30 PM', '6:00 PM', '7:00 PM', '8:00 PM'];

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    dangerouslyAllowBrowser: false
  });
}

function extractJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return null;
    }
  }
}

function normalizeSelectedEvents(selectedEvents = []) {
  return (Array.isArray(selectedEvents) ? selectedEvents : [])
    .map((event, index) => ({
      id: event?.id || `event-${index + 1}`,
      name: String(event?.name || event?.title || '').trim(),
      venue: String(event?.venue || event?.address || '').trim(),
      when: String(event?.when || event?.date || event?.date_label || '').trim()
    }))
    .filter((event) => event.name);
}

function buildSelectedEventsPrompt(selectedEvents = []) {
  const events = normalizeSelectedEvents(selectedEvents);
  if (!events.length) return 'No fixed local events selected.';

  const summary = events
    .map((event, index) => {
      const venueText = event.venue ? ` at ${event.venue}` : '';
      const timeText = event.when ? ` (${event.when})` : '';
      return `${index + 1}. ${event.name}${venueText}${timeText}`;
    })
    .join(' ');

  return `Selected local events. Include each of these exactly once in the itinerary when possible: ${summary}`;
}

function extractEventTime(event, index) {
  const match = `${event?.when || ''} ${event?.date || ''}`.match(/\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm))\b/);
  if (match) return match[1].toUpperCase().replace(/\s+/g, ' ');
  return EVENT_ACTIVITY_TIMES[index % EVENT_ACTIVITY_TIMES.length];
}

function timeToMinutes(label) {
  const match = String(label || '').match(/(\d{1,2})(?::(\d{2}))?\s?(AM|PM)/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hours = parseInt(match[1], 10) % 12;
  const minutes = parseInt(match[2] || '0', 10);
  if (match[3].toUpperCase() === 'PM') hours += 12;
  return (hours * 60) + minutes;
}

function mergeSelectedEventsIntoItinerary(itinerary, selectedEvents = [], dayCount = null) {
  const events = normalizeSelectedEvents(selectedEvents);
  const fallbackDays = Math.max(1, dayCount || (Array.isArray(itinerary) && itinerary.length ? itinerary.length : 1));
  const baseItinerary = Array.isArray(itinerary) && itinerary.length
    ? itinerary.map((day, index) => ({
      day: Number(day?.day) || (index + 1),
      activities: Array.isArray(day?.activities) ? day.activities.map((activity) => ({ ...activity })) : []
    }))
    : Array.from({ length: fallbackDays }, (_, index) => ({
      day: index + 1,
      activities: []
    }));

  if (!events.length) return baseItinerary;

  const existingTitles = new Set(
    baseItinerary.flatMap((day) =>
      day.activities.map((activity) => String(activity?.title || '').trim().toLowerCase()).filter(Boolean)
    )
  );

  events.forEach((event, index) => {
    const key = event.name.toLowerCase();
    if (existingTitles.has(key)) return;

    const day = baseItinerary[index % baseItinerary.length];
    day.activities.push({
      time: extractEventTime(event, index),
      title: event.name,
      type: 'event',
      venue: event.venue || undefined
    });
    day.activities.sort((left, right) => timeToMinutes(left?.time) - timeToMinutes(right?.time));
    existingTitles.add(key);
  });

  return baseItinerary;
}

async function generateWithOpenAI(destination, days, interests, contextStr, selectedEvents = []) {
  const client = getOpenAIClient();
  if (!client) return null;

  const prompt = `
Create a detailed ${days}-day travel itinerary for ${destination}.
Interests: ${interests.join(', ')}.
Context: ${contextStr}.
${buildSelectedEventsPrompt(selectedEvents)}

Return strictly a JSON object with this key: "itinerary".
"itinerary" should be an array of objects, one for each day, with fields:
- "day" (number)
- "activities": array of objects { "time": "10:00 AM", "title": "Activity name", "type": "culture/food/adventure/etc" }
  `.trim();

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a helpful travel assistant that outputs only JSON.' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' }
  });

  const result = extractJson(completion.choices?.[0]?.message?.content || '');
  return Array.isArray(result?.itinerary) ? result.itinerary : null;
}

async function generateWithGemini(destination, days, interests, contextStr, selectedEvents = []) {
  if (!process.env.GEMINI_API_KEY) return null;

  const prompt = `
Create a detailed ${days}-day travel itinerary for ${destination}.
Interests: ${interests.join(', ')}.
Context: ${contextStr}.
${buildSelectedEventsPrompt(selectedEvents)}

Return only valid JSON in this shape:
{
  "itinerary": [
    {
      "day": 1,
      "activities": [
        { "time": "10:00 AM", "title": "Activity name", "type": "culture" }
      ]
    }
  ]
}
  `.trim();

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) return null;

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  const result = extractJson(text);
  return Array.isArray(result?.itinerary) ? result.itinerary : null;
}

/**
 * Generate itinerary using OpenAI or Gemini, then fall back to local templates.
 */
async function generateItinerary(destination, days, interests, contextStr = '', selectedEvents = []) {
  try {
    const openAiItinerary = await generateWithOpenAI(destination, days, interests, contextStr, selectedEvents);
    if (openAiItinerary) return mergeSelectedEventsIntoItinerary(openAiItinerary, selectedEvents, days);
  } catch (err) {
    console.error('OpenAI Itinerary Error:', err.message);
  }

  try {
    const geminiItinerary = await generateWithGemini(destination, days, interests, contextStr, selectedEvents);
    if (geminiItinerary) return mergeSelectedEventsIntoItinerary(geminiItinerary, selectedEvents, days);
  } catch (err) {
    console.error('Gemini Itinerary Error:', err.message);
  }

  return mergeSelectedEventsIntoItinerary(
    generateStaticItinerary(destination, days, interests),
    selectedEvents,
    days
  );
}

function generateStaticItinerary(destination, days, interests) {
  const normalizedDestination = (destination || '').toLowerCase();
  const curated = destinationData.destinations || {};
  const fallback = destinationData.generic || {
    culture: ['Local culture experience'],
    food: ['Local food exploration'],
    adventure: ['Outdoor activity'],
    shopping: ['Local market visit']
  };
  const destKey = Object.keys(curated).find((key) => normalizedDestination.includes(key));
  const destData = (destKey && curated[destKey]) ? curated[destKey] : fallback;

  const itinerary = [];
  const userInterests = (interests && interests.length) ? interests : ['culture', 'food', 'adventure', 'shopping'];

  for (let i = 1; i <= days; i++) {
    const dayPlan = {
      day: i,
      activities: []
    };

    const morningInterest = userInterests[(i - 1) % userInterests.length];
    const morningPool = destData[morningInterest] || fallback[morningInterest] || fallback.culture;
    const morningActivity = morningPool[Math.floor(Math.random() * morningPool.length)];

    dayPlan.activities.push({
      time: '10:00 AM',
      title: morningActivity,
      type: morningInterest
    });

    dayPlan.activities.push({
      time: '1:00 PM',
      title: 'Lunch at a local favorite spot',
      type: 'food'
    });

    const afternoonInterest = userInterests[i % userInterests.length];
    const afternoonPool = destData[afternoonInterest] || fallback[afternoonInterest] || fallback.shopping;
    let afternoonActivity = afternoonPool[Math.floor(Math.random() * afternoonPool.length)];

    while (afternoonActivity === morningActivity && afternoonPool.length > 1) {
      afternoonActivity = afternoonPool[Math.floor(Math.random() * afternoonPool.length)];
    }

    dayPlan.activities.push({
      time: '3:00 PM',
      title: afternoonActivity,
      type: afternoonInterest
    });

    dayPlan.activities.push({
      time: '7:30 PM',
      title: 'Dinner and relaxation',
      type: 'food'
    });

    itinerary.push(dayPlan);
  }

  return itinerary;
}

module.exports = { generateItinerary };
