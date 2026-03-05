const destinationData = require('./destinations');


const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'MISSING_KEY',
    dangerouslyAllowBrowser: false
});

/**
 * Generate itinerary using OpenAI (or fallback to logic).
 */
async function generateItinerary(destination, days, interests, contextStr = '') {
    // If no key, fallback to static generation
    if (!process.env.OPENAI_API_KEY) {
        return generateStaticItinerary(destination, days, interests);
    }

    try {
        const prompt = `
      Create a detailed ${days}-day travel itinerary for ${destination}.
      Interests: ${interests.join(', ')}.
      Context: ${contextStr}.
      
      Return strictly a JSON object with this key: "itinerary".
      "itinerary" should be an array of objects, one for each day, with fields:
      - "day" (number)
      - "activities": array of objects { "time": "10:00 AM", "title": "Activity name", "type": "culture/food/adventure/etc" }
    `;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a helpful travel assistant that outputs only JSON." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        const content = completion.choices[0].message.content;
        const result = JSON.parse(content);

        // Validate structure
        if (Array.isArray(result.itinerary)) {
            return result.itinerary;
        }
        throw new Error('Invalid AI response structure');
    } catch (err) {
        console.error('OpenAI Itinerary Error:', err.message);
        return generateStaticItinerary(destination, days, interests);
    }
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
    const destKey = Object.keys(curated).find(k => normalizedDestination.includes(k));
    const destData = (destKey && curated[destKey]) ? curated[destKey] : fallback;

    const itinerary = [];
    const userInterests = (interests && interests.length) ? interests : ['culture', 'food', 'adventure', 'shopping'];

    for (let i = 1; i <= days; i++) {
        const dayPlan = {
            day: i,
            activities: []
        };

        // Morning Activity
        const morningInterest = userInterests[(i - 1) % userInterests.length];
        const morningPool = destData[morningInterest] || fallback[morningInterest] || fallback['culture'];
        const morningActivity = morningPool[Math.floor(Math.random() * morningPool.length)];

        dayPlan.activities.push({
            time: '10:00 AM',
            title: morningActivity,
            type: morningInterest
        });

        // Lunch
        dayPlan.activities.push({
            time: '1:00 PM',
            title: 'Lunch at a local favorite spot',
            type: 'food'
        });

        // Afternoon Activity
        const afternoonInterest = userInterests[(i) % userInterests.length];
        const afternoonPool = destData[afternoonInterest] || fallback[afternoonInterest] || fallback['shopping'];
        let afternoonActivity = afternoonPool[Math.floor(Math.random() * afternoonPool.length)];
        // Ensure distinct from morning
        while (afternoonActivity === morningActivity && afternoonPool.length > 1) {
            afternoonActivity = afternoonPool[Math.floor(Math.random() * afternoonPool.length)];
        }

        dayPlan.activities.push({
            time: '3:00 PM',
            title: afternoonActivity,
            type: afternoonInterest
        });

        // Dinner/Evening
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
