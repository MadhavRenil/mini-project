const destinationData = require('./destinations');
const OpenAI = require('openai');

const GEMINI_MODEL = 'gemini-2.5-flash';

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

async function generateWithOpenAI(destination, days, interests, contextStr) {
  const client = getOpenAIClient();
  if (!client) return null;

  const prompt = `
Create a detailed ${days}-day travel itinerary for ${destination}.
Interests: ${interests.join(', ')}.
Context: ${contextStr}.

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

async function generateWithGemini(destination, days, interests, contextStr) {
  if (!process.env.GEMINI_API_KEY) return null;

  const prompt = `
Create a detailed ${days}-day travel itinerary for ${destination}.
Interests: ${interests.join(', ')}.
Context: ${contextStr}.

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
async function generateItinerary(destination, days, interests, contextStr = '') {
  try {
    const openAiItinerary = await generateWithOpenAI(destination, days, interests, contextStr);
    if (openAiItinerary) return openAiItinerary;
  } catch (err) {
    console.error('OpenAI Itinerary Error:', err.message);
  }

  try {
    const geminiItinerary = await generateWithGemini(destination, days, interests, contextStr);
    if (geminiItinerary) return geminiItinerary;
  } catch (err) {
    console.error('Gemini Itinerary Error:', err.message);
  }

  return generateStaticItinerary(destination, days, interests);
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
