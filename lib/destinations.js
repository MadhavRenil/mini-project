module.exports = {
    // Database of destinations with curated activities
    destinations: {
        'new york': {
            culture: ['Visit the Met Museum', 'Walk across Brooklyn Bridge', 'See a Broadway Show', 'Tour the Statue of Liberty'],
            food: ['Pizza tour in Brooklyn', 'Fine dining at Le Bernardin', 'Chelsea Market food crawl', 'Bagel breakfast in Manhattan'],
            adventure: ['Helicopter tour over NYC', 'Bike ride in Central Park', 'Kayaking on the Hudson', 'Top of the Rock observation deck'],
            shopping: ['Shopping on 5th Avenue', 'SoHo boutiques', 'Thrift shopping in East Village', 'Macy\'s Herald Square']
        },
        'london': {
            culture: ['British Museum tour', 'Visit Tower of London', 'Changing of the Guard', 'Westminster Abbey'],
            food: ['Afternoon Tea at the Ritz', 'Borough Market food tasting', 'Curry on Brick Lane', 'Fish and Chips at a local pub'],
            adventure: ['Climb the O2 Arena', 'Speedboat on the Thames', 'London Eye flight', 'Dungeon Experience'],
            shopping: ['Harrods', 'Oxford Street', 'Camden Market', 'Portobello Road Market']
        },
        'paris': {
            culture: ['Louvre Museum', 'Eiffel Tower at night', 'Montmartre art walk', 'Notre Dame Cathedral'],
            food: ['Pastry tasting at diverse patisseries', 'Dinner cruise on Seine', 'Wine tasting in Le Marais', 'Picnic near Eiffel Tower'],
            adventure: ['Catacombs tour', 'Bike tour of Versailles', 'Seine river cruise', 'Climb Arc de Triomphe'],
            shopping: ['Champs-Élysées', 'Galeries Lafayette', 'Le Marais boutiques', 'Saint-Ouen Flea Market']
        },
        'dubai': {
            culture: ['Visit Jumeirah Mosque', 'Explore Al Fahidi Historic District', 'Dubai Museum', 'Gold Souk market'],
            food: ['Dinner in the Sky', 'Traditional Emirati breakfast', 'High tea at Burj Al Arab', 'Global Village food tour'],
            adventure: ['Desert Safari with Dune Bashing', 'Skydiving over Palm Jumeirah', 'Ski Dubai', 'Aquaventure Waterpark'],
            shopping: ['Dubai Mall', 'Mall of the Emirates', 'Souk Madinat Jumeirah', 'Gold and Spice Souks']
        },
        'bali': {
            culture: ['Uluwatu Temple sunset', 'Ubud Palace', 'Traditional Dance Show', 'Besakih Temple'],
            food: ['Seafood dinner at Jimbaran', 'Cooking class in Ubud', 'Floating breakfast', 'Coffee plantation tour'],
            adventure: ['Surfing in Kuta', 'Mount Batur sunrise trek', 'White water rafting', 'ATV ride in jungle'],
            shopping: ['Ubud Art Market', 'Seminyak boutiques', 'Canggu markets', 'Silver jewelry making']
        },
        'tokyo': {
            culture: ['Senso-ji Temple', 'Meiji Shrine', 'TeamLab Borderless', 'Imperial Palace'],
            food: ['Tsukiji Outer Market sushi', 'Ramen street tour', 'Izakaya hoping in Shinjuku', 'Theme cafe experience'],
            adventure: ['Go-karting in Akihabara', 'Sumo wrestling practice', 'Tokyo Skytree observation', 'DisneySea'],
            shopping: ['Ginza district', 'Takeshita Street in Harajuku', 'Akihabara electronics', 'Shibuya 109']
        }
    },
    // Generic fallback if destination not found
    generic: {
        culture: ['Visit local history museum', 'City walking tour', 'Visit calm historic sites', 'Local art gallery'],
        food: ['Try local street food', 'Fine dining experience', 'Visit local markets', 'Traditional cooking class'],
        adventure: ['Hiking in nature trails', 'Rent a bike and explore', 'Local water sports', 'Panoramic city view point'],
        shopping: ['Local souvenir shops', 'Main street shopping', 'Local craft markets', 'Modern shopping malls']
    }
};
