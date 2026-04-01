import { FILTERS } from './src/config.js';
console.log('Current FILTERS.excludeKeywords:', JSON.stringify(FILTERS.excludeKeywords, null, 2));

import { fetchGorodZovetEvents } from './src/gorodzovet.js';
(async () => {
    console.log('Testing Simferopol (sim) events...');
    const events = await fetchGorodZovetEvents('sim');
    console.log(`Found ${events.length} events after filtering.`);
    events.forEach(e => {
        console.log(`- ${e.title} (${e.price})`);
    });
})();
