import { fetchEvents as fetchKudaGoEvents, formatEventsMessage as formatKudaGo, fetchEventsByCategory as fetchKudaGoByCat, formatEventsPage as formatKudaGoPage } from './kudago.js';
import { fetchGorodZovetEvents, formatGorodZovetMessage, fetchGZEventsByCategory } from './gorodzovet.js';
import { CITIES } from './config.js';

/**
 * Unified events service that uses the appropriate source for each city
 * - KudaGo: msk, spb
 * - GorodZovet: smr, sim
 */

const KUDAGO_CITIES = ['msk', 'spb'];
const GORODZOVET_CITIES = ['smr', 'sim'];

// City slug mapping for GorodZovet
const GORODZOVET_SLUGS = {
    msk: 'moskva',
    spb: 'spb',
    smr: 'samara',
    sim: 'simferopol'
};

/**
 * Fetch events for any supported city
 */
export async function fetchEvents(citySlug) {
    if (KUDAGO_CITIES.includes(citySlug)) {
        return await fetchKudaGoEvents(citySlug);
    } else if (GORODZOVET_CITIES.includes(citySlug)) {
        const gorodzovetSlug = GORODZOVET_SLUGS[citySlug];
        return await fetchGorodZovetEvents(gorodzovetSlug);
    } else {
        console.error(`Unknown city slug: ${citySlug}`);
        return [];
    }
}

/**
 * Format events message for any supported city
 */
export function formatEventsMessage(events, citySlug) {
    const city = CITIES[citySlug];
    const cityName = city ? city.name : 'Неизвестный город';

    if (KUDAGO_CITIES.includes(citySlug)) {
        return formatKudaGo(events, cityName);
    } else {
        return formatGorodZovetMessage(events, cityName);
    }
}

/**
 * Fetch events by category with pagination
 */
export async function fetchEventsByCategory(citySlug, category, page = 0) {
    if (KUDAGO_CITIES.includes(citySlug)) {
        return await fetchKudaGoByCat(citySlug, category, page);
    } else if (GORODZOVET_CITIES.includes(citySlug)) {
        const gorodzovetSlug = GORODZOVET_SLUGS[citySlug];
        return await fetchGZEventsByCategory(gorodzovetSlug, category, page);
    } else {
        return { events: [], hasMore: false };
    }
}

/**
 * Format a page of events
 */
export function formatEventsPage(events, citySlug, category, page, hasMore) {
    const city = CITIES[citySlug];
    const cityName = city ? city.name : 'Неизвестный город';

    if (KUDAGO_CITIES.includes(citySlug)) {
        return formatKudaGoPage(events, cityName, category, page, hasMore);
    } else {
        return formatKudaGoPage(events, cityName, category, page, hasMore); // same format
    }
}
