import axios from 'axios';

async function check() {
    const url = 'https://afisha.yandex.ru/moscow/concert?date-from=2026-03-13&date-to=2026-03-15';
    console.log(`📡 Fetching ${url}`);
    
    try {
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html'
            }
        });
        
        const html = res.data;
        console.log(`HTML Length: ${html.length}`);
        
        const apolloStateMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*({.+?});/);
        if (!apolloStateMatch) {
            console.log('❌ No APOLLO_STATE found');
            return;
        }
        
        const state = JSON.parse(apolloStateMatch[1]);
        const keys = Object.keys(state);
        console.log(`Found ${keys.length} keys in state`);
        
        const events = keys.filter(k => k.startsWith('Event:'));
        console.log(`Found ${events.length} event objects`);
        
        for (const k of events) {
            const event = state[k];
            if (event.title && event.title.includes('Комната культуры')) {
                console.log(`✅ FOUND: ${event.title}`);
                process.exit(0);
            }
        }
        
        console.log('❌ Still not found in APOLLO_STATE.');
        // Print some titles to see what WE DO see
        console.log('Sample titles:', events.slice(0, 5).map(k => state[k].title).join(', '));
        
    } catch (e) {
        console.error(e.message);
    }
}

check();
