import axios from 'axios';
import { YANDEX_AFISHA, FILTERS, HOLIDAYS } from './config.js';
import { cleanTitle, cleanDescription, escapeHTML } from './textUtils.js';

/**
 * Yandex Afisha city slug mapping
 */
const CITY_SLUGS = {
    msk: 'moscow',
    spb: 'saint-petersburg'
};

/**
 * Category URL paths on Yandex Afisha
 */
const CATEGORY_PATHS = {
    concert: 'concert',
    theater: 'theatre',
    exhibition: 'art',
    festival: 'festival',
    education: 'masterclass'
};

/**
 * Check if a date is a public holiday
 */
function isHoliday(date) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return HOLIDAYS.includes(`${mm}-${dd}`);
}

/**
 * Get upcoming weekend dates, extended with adjacent holidays
 */
function getWeekendDates() {
    const now = new Date();
    const dayOfWeek = now.getDay();

    let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
    if (daysUntilFriday === 0 && now.getHours() >= 18) {
        daysUntilFriday = 0;
    } else if (dayOfWeek === 6) {
        daysUntilFriday = -1;
    } else if (dayOfWeek === 0) {
        daysUntilFriday = -2;
    }

    const friday = new Date(now);
    friday.setDate(now.getDate() + daysUntilFriday);
    friday.setHours(0, 0, 0, 0);

    const sunday = new Date(friday);
    sunday.setDate(friday.getDate() + 2);

    let startDate = new Date(friday);
    for (let i = 1; i <= 5; i++) {
        const prevDay = new Date(friday);
        prevDay.setDate(friday.getDate() - i);
        if (isHoliday(prevDay)) {
            startDate = prevDay;
        } else {
            break;
        }
    }

    let endDate = new Date(sunday);
    for (let i = 1; i <= 5; i++) {
        const nextDay = new Date(sunday);
        nextDay.setDate(sunday.getDate() + i);
        if (isHoliday(nextDay)) {
            endDate = nextDay;
        } else {
            break;
        }
    }

    startDate.setHours(17, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    console.log(`📅 Event range: ${startDate.toLocaleDateString('ru-RU')} — ${endDate.toLocaleDateString('ru-RU')}`);

    return {
        since: Math.floor(startDate.getTime() / 1000),
        until: Math.floor(endDate.getTime() / 1000),
        startDate,
        endDate
    };
}

/**
 * Format weekend dates as human-readable string
 */
function getWeekendDatesFormatted() {
    const { startDate, endDate } = getWeekendDates();
    const pad = n => String(n).padStart(2, '0');
    const startStr = `${pad(startDate.getDate())}.${pad(startDate.getMonth() + 1)}`;
    const endStr = `${pad(endDate.getDate())}.${pad(endDate.getMonth() + 1)}`;
    return `с ${startStr} - ${endStr}`;
}

/**
 * Extract a balanced JS object starting from position `start` in the string
 * Handles strings (single and double quoted) to avoid counting braces inside them
 */
function extractBalancedObject(str, start) {
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let i = start; i < str.length; i++) {
        const ch = str[i];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (ch === '\\') {
            escaped = true;
            continue;
        }

        if (ch === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            continue;
        }

        if (ch === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }

        if (inSingleQuote || inDoubleQuote) continue;

        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) {
                return str.substring(start, i + 1);
            }
        }
    }

    return null;
}

/**
 * Fetch HTML page and extract __APOLLO_STATE__ embedded data
 * Uses brace-counting for reliable extraction of the JS object
 * Retries up to 2 times on failure
 */
async function fetchApolloState(url, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            if (attempt > 0) {
                await new Promise(r => setTimeout(r, 2000 * attempt));
                console.log(`🔄 Retry #${attempt} for ${url}`);
            }

            const res = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ru-RU,ru;q=0.9'
                },
                timeout: 15000
            });

            const html = res.data;

            // Find the start of __APOLLO_STATE__ assignment
            const markers = ["window['__APOLLO_STATE__'] = ", 'window["__APOLLO_STATE__"] = ', '__APOLLO_STATE__ = '];

            for (const marker of markers) {
                const idx = html.indexOf(marker);
                if (idx === -1) continue;

                const objStart = idx + marker.length;
                const braceIdx = html.indexOf('{', objStart);
                if (braceIdx === -1 || braceIdx - objStart > 5) continue;

                const objStr = extractBalancedObject(html, braceIdx);
                if (objStr) {
                    try {
                        return new Function('return ' + objStr)();
                    } catch (e) {
                        console.error('Apollo eval error:', e.message);
                    }
                }
            }

            // If no Apollo state found, retry
            if (attempt < retries) continue;

            console.warn(`⚠️ No __APOLLO_STATE__ found in ${url}`);
            return null;
        } catch (error) {
            if (attempt >= retries) {
                console.error(`❌ Yandex Afisha fetch error (${url}):`, error.message);
                return null;
            }
        }
    }
    return null;
}

// ─── Data Parsing ──────────────────────────────────────────────────

/**
 * Parse events from Apollo state cache
 * Resolves references between EventPreview, Ticket, PlacePreview, and Featured
 */
function parseEvents(apollo) {
    if (!apollo) return [];

    const keys = Object.keys(apollo);
    const events = [];

    // Collect EventPreview entries
    const eventKeys = keys.filter(k => k.startsWith('EventPreview:'));

    // Build Featured map for schedule info and place refs
    const featuredMap = {};
    keys.filter(k => k.startsWith('Featured:')).forEach(k => {
        const featured = apollo[k];
        if (featured?.object?.event?.__ref) {
            const eventRef = featured.object.event.__ref;
            featuredMap[eventRef] = featured;
        }
    });

    for (const key of eventKeys) {
        const ep = apollo[key];
        if (!ep) continue;

        // Resolve ticket price
        let priceStr = 'Цена не указана';
        if (ep.tickets && ep.tickets.length > 0) {
            const ticketRef = ep.tickets[0].__ref;
            const ticket = apollo[ticketRef];
            if (ticket?.price) {
                const minRub = Math.round(ticket.price.min / 100);
                const maxRub = Math.round(ticket.price.max / 100);
                if (minRub === 0) {
                    priceStr = 'Бесплатно';
                } else if (minRub === maxRub) {
                    priceStr = `${minRub.toLocaleString('ru-RU')} ₽`;
                } else {
                    priceStr = `от ${minRub.toLocaleString('ru-RU')} ₽`;
                }
            }
        }

        // Resolve place from Featured entry
        let place = null;
        const featured = featuredMap[key];
        if (featured?.object) {
            // Try to find place reference in scheduleInfo or directly
            const placeRef = featured.object.place?.__ref;
            if (placeRef && apollo[placeRef]) {
                const pp = apollo[placeRef];
                place = {
                    title: pp.title || '',
                    address: pp.address || ''
                };
            }
        }

        // Fallback: try to find PlacePreview linked to this event anywhere in apollo
        if (!place) {
            // Look through all Featured entries for this event
            for (const fk of Object.keys(apollo)) {
                if (!fk.startsWith('Featured:')) continue;
                const f = apollo[fk];
                if (f?.object?.event?.__ref === key) {
                    // Check for place inside scheduleInfo
                    const si = f.object.scheduleInfo;
                    if (si) {
                        // Some Featured entries have place refs in nested structures
                        for (const siKey of Object.keys(si)) {
                            const val = si[siKey];
                            if (val && typeof val === 'object' && val.__ref && val.__ref.startsWith('PlacePreview:')) {
                                const pp = apollo[val.__ref];
                                if (pp) {
                                    place = { title: pp.title || '', address: pp.address || '' };
                                    break;
                                }
                            }
                        }
                    }
                    break;
                }
            }
        }

        // Extract schedule dates from Featured
        let dates = [];
        if (featured?.object?.scheduleInfo) {
            const si = featured.object.scheduleInfo;
            dates = si.dates || [];
        }

        // Determine event type from tags
        let category = 'other';
        const tagsKey = Object.keys(ep).find(k => k.startsWith('tags(') && k.includes('approved') && k.includes('reviewed'));
        if (tagsKey && Array.isArray(ep[tagsKey])) {
            const tagCodes = ep[tagsKey].map(t => t.code).filter(Boolean);
            if (tagCodes.includes('concert')) category = 'concert';
            else if (tagCodes.includes('theatre') || tagCodes.includes('theater')) category = 'theater';
            else if (tagCodes.includes('exhibition')) category = 'exhibition';
            else if (tagCodes.includes('festival')) category = 'festival';
            else if (tagCodes.includes('master-class') || tagCodes.includes('masterclass') || tagCodes.includes('education')) category = 'education';
        }

        // Fallback: detect category from URL path
        if (category === 'other' && ep.url) {
            const urlPath = ep.url.toLowerCase();
            if (urlPath.includes('/concert/')) category = 'concert';
            else if (urlPath.includes('/theatre/') || urlPath.includes('/theater/')) category = 'theater';
            else if (urlPath.includes('/art/') || urlPath.includes('/exhibition/') || urlPath.includes('/museum/')) category = 'exhibition';
            else if (urlPath.includes('/festival/')) category = 'festival';
            else if (urlPath.includes('/masterclass/') || urlPath.includes('/education/')) category = 'education';
        }

        // Build URL
        const eventUrl = ep.url
            ? `${YANDEX_AFISHA.baseUrl}${ep.url}`
            : `${YANDEX_AFISHA.baseUrl}/moscow/event/${ep.id}`;

        // Build image URL (pick a medium-sized one)
        let imageUrl = null;
        if (ep.image) {
            const imgKey = Object.keys(ep.image).find(k => k.includes('s380x220'));
            if (imgKey && ep.image[imgKey]?.url) {
                imageUrl = ep.image[imgKey].url;
            }
        }

        // Build description: use argument, or generate fallback based on category
        let description = ep.argument || '';
        if (!description) {
            const fallbacks = {
                'concert': 'Живое музыкальное выступление для ценителей хорошего звука',
                'theater': 'Театральная постановка для яркого культурного вечера',
                'exhibition': 'Выставка с интересными экспонатами и уникальными работами',
                'festival': 'Фестиваль с разнообразной программой и активностями',
                'education': 'Познавательное мероприятие для расширения кругозора',
                'other': 'Интересное мероприятие для культурного отдыха'
            };
            description = fallbacks[category] || fallbacks['other'];
        }

        events.push({
            id: ep.id,
            title: ep.title || 'Без названия',
            short_title: ep.title,
            description: description,
            price: priceStr,
            site_url: eventUrl,
            place: place,
            categories: [category],
            age_restriction: ep.contentRating || null,
            images: imageUrl ? [{ image: imageUrl }] : [],
            dates: dates,
            source: 'yandex_afisha'
        });
    }

    return events;
}

// ─── Filtering & Sorting ──────────────────────────────────────────

/**
 * Filter events based on criteria
 */
function filterEvents(events) {
    return events.filter(event => {
        // Exclude 18+ events
        if (event.age_restriction === '18+') return false;

        const title = (event.title || '').toLowerCase();
        const description = (event.description || '').toLowerCase();

        const hasExcludedKeyword = FILTERS.excludeKeywords.some(keyword =>
            title.includes(keyword.toLowerCase()) ||
            description.includes(keyword.toLowerCase())
        );

        if (hasExcludedKeyword) return false;

        // Check price (parse number from price string)
        const priceNumbers = event.price.match(/\d[\d\s]*/);
        if (priceNumbers) {
            const price = parseInt(priceNumbers[0].replace(/\s/g, ''), 10);
            if (price > FILTERS.maxPrice) return false;
        }

        return true;
    });
}

/**
 * Simple seeded random number generator for consistent weekly shuffling
 */
function seededRandom(seed) {
    let s = seed;
    return function () {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/**
 * Get current week number for seeding
 */
function getWeekSeed() {
    return Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Sort events with weekly rotation
 */
function sortEvents(events) {
    const weekSeed = getWeekSeed();
    const rng = seededRandom(weekSeed);

    const scored = events.map(event => {
        let score = 0;

        // Events with images get a bonus
        if (event.images && event.images.length > 0) score += 10;

        // Add weekly randomness (0 to 8 points)
        score += rng() * 8;

        return { event, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.event);
}

// ─── Event Type Detection ──────────────────────────────────────────

/**
 * Determine the event type from its categories or title
 */
function getEventType(event) {
    if (event.categories && event.categories.length > 0 && event.categories[0] !== 'other') {
        return event.categories[0];
    }

    const title = (event.title || '').toLowerCase();
    if (title.includes('выставк') || title.includes('экспозиц')) return 'exhibition';
    if (title.includes('концерт') || title.includes('музык')) return 'concert';
    if (title.includes('спектакл') || title.includes('театр') || title.includes('мюзикл')) return 'theater';
    if (title.includes('фестиваль') || title.includes('фест')) return 'festival';
    if (title.includes('лекци') || title.includes('мастер-класс')) return 'education';

    return 'other';
}

// ─── Diverse Selection ─────────────────────────────────────────────

/**
 * Select diverse events ensuring different categories are represented
 */
export function selectDiverseEvents(events, count = 3) {
    if (events.length <= count) return events;

    const allTypes = ['exhibition', 'concert', 'theater', 'festival', 'education'];
    const weekSeed = getWeekSeed();
    const startIdx = weekSeed % allTypes.length;
    const rotatedTypes = [
        ...allTypes.slice(startIdx),
        ...allTypes.slice(0, startIdx)
    ];

    const byType = {};
    for (const event of events) {
        const type = getEventType(event);
        if (!byType[type]) byType[type] = [];
        byType[type].push(event);
    }

    console.log('📊 Event type distribution:', Object.keys(byType).map(k => `${k}: ${byType[k].length}`).join(', '));

    const selected = [];
    const usedIds = new Set();

    for (const type of rotatedTypes) {
        if (selected.length >= count) break;
        if (byType[type] && byType[type].length > 0) {
            const event = byType[type].shift();
            if (!usedIds.has(event.id)) {
                selected.push(event);
                usedIds.add(event.id);
                console.log(`  ✅ Picked [${type}]: ${event.title}`);
            }
        }
    }

    // Fill remaining slots
    const usedTypes = new Set(selected.map(e => getEventType(e)));
    if (selected.length < count) {
        for (const event of events) {
            if (selected.length >= count) break;
            const type = getEventType(event);
            if (!usedIds.has(event.id) && !usedTypes.has(type)) {
                selected.push(event);
                usedIds.add(event.id);
                usedTypes.add(type);
            }
        }
    }

    if (selected.length < count) {
        for (const event of events) {
            if (selected.length >= count) break;
            if (!usedIds.has(event.id)) {
                selected.push(event);
                usedIds.add(event.id);
            }
        }
    }

    return selected;
}

// ─── Fetching ──────────────────────────────────────────────────────

/**
 * Fetch events for a single category from Yandex Afisha
 */
async function fetchCategoryPage(citySlug, category) {
    const afishaCity = CITY_SLUGS[citySlug] || citySlug;
    const categoryPath = CATEGORY_PATHS[category] || category;
    const url = `${YANDEX_AFISHA.baseUrl}/${afishaCity}/${categoryPath}`;

    console.log(`📡 Fetching: ${url}`);
    const apollo = await fetchApolloState(url);
    if (!apollo) return [];

    return parseEvents(apollo);
}

/**
 * Fetch events from Yandex Afisha — per-category for diversity
 * Sequential fetching with delays to avoid rate limiting
 */
export async function fetchEvents(citySlug) {
    const targetCategories = Object.keys(CATEGORY_PATHS);

    try {
        // Fetch each category sequentially with delay
        const categoryResults = [];
        for (const cat of targetCategories) {
            const events = await fetchCategoryPage(citySlug, cat);
            categoryResults.push(events);
            // Delay between requests to avoid rate limiting
            await new Promise(r => setTimeout(r, 1500));
        }

        // Merge and deduplicate
        const seenIds = new Set();
        let allEvents = [];
        for (const events of categoryResults) {
            for (const event of events) {
                if (!seenIds.has(event.id)) {
                    seenIds.add(event.id);
                    allEvents.push(event);
                }
            }
        }

        // Apply filters
        allEvents = filterEvents(allEvents);

        // Sort by priority with weekly rotation
        allEvents = sortEvents(allEvents);

        console.log(`Yandex Afisha ${citySlug}: fetched ${allEvents.length} events across ${targetCategories.length} categories`);

        return allEvents.slice(0, FILTERS.maxEvents);
    } catch (error) {
        console.error(`❌ Yandex Afisha Error (${citySlug}):`, error.message);
        return [];
    }
}

/**
 * Fetch events by specific category with pagination
 */
export async function fetchEventsByCategory(citySlug, category, page = 0, perPage = 5) {
    try {
        let allEvents;

        if (category === 'all') {
            const targetCategories = Object.keys(CATEGORY_PATHS);
            const categoryResults = await Promise.all(
                targetCategories.map(cat => fetchCategoryPage(citySlug, cat))
            );
            const seenIds = new Set();
            allEvents = [];
            for (const events of categoryResults) {
                for (const event of events) {
                    if (!seenIds.has(event.id)) {
                        seenIds.add(event.id);
                        allEvents.push(event);
                    }
                }
            }
        } else {
            allEvents = await fetchCategoryPage(citySlug, category);
        }

        // Apply filters and sort
        allEvents = filterEvents(allEvents);
        allEvents = sortEvents(allEvents);

        // Paginate
        const start = page * perPage;
        const end = start + perPage;
        const pageEvents = allEvents.slice(start, end);
        const hasMore = end < allEvents.length && page < 5;

        return { events: pageEvents, hasMore };
    } catch (error) {
        console.error(`❌ Yandex Afisha category Error (${citySlug}/${category}):`, error.message);
        return { events: [], hasMore: false };
    }
}

// ─── Formatting ────────────────────────────────────────────────────

/**
 * Generate a fallback description based on event type
 */
function getFallbackDescription(event) {
    const type = getEventType(event);
    const fallbacks = {
        'exhibition': 'Выставка с интересными экспонатами и уникальными работами',
        'concert': 'Живое музыкальное выступление для ценителей хорошего звука',
        'theater': 'Театральная постановка для яркого культурного вечера',
        'festival': 'Фестиваль с разнообразной программой и активностями',
        'education': 'Познавательное мероприятие для расширения кругозора',
        'other': 'Интересное мероприятие для культурного отдыха'
    };
    return fallbacks[type] || fallbacks['other'];
}

/**
 * Format event for Telegram message (HTML mode)
 */
function formatEvent(event, index) {
    const title = event.title || 'Без названия';
    const cleanedTitle = cleanTitle(title);
    const price = event.price || 'Цена не указана';
    const url = event.site_url || `${YANDEX_AFISHA.baseUrl}/moscow`;

    let text = `${index + 1}. <a href="${escapeHTML(url)}">${escapeHTML(cleanedTitle)}</a>\n`;

    let details = [];

    let desc = '';
    if (event.description) {
        desc = cleanDescription(event.description, 120);
    }
    if (!desc) {
        desc = getFallbackDescription(event);
    }
    if (desc) details.push(escapeHTML(desc));

    details.push(`💰 ${escapeHTML(price)}`);

    if (event.place && event.place.title) {
        details.push(`📍 ${escapeHTML(event.place.title)}`);
    }

    text += `<blockquote expandable>${details.join('\n')}</blockquote>`;

    return text;
}

/**
 * Format events list for Telegram
 */
export function formatEventsMessage(events, cityName) {
    if (events.length === 0) {
        return `😔 К сожалению, не нашлось подходящих мероприятий в городе ${cityName} на эти выходные.`;
    }

    const dates = getWeekendDatesFormatted();
    let message = `🎉 <b>Мероприятия ${dates} в городе ${escapeHTML(cityName)}:</b>\n\n`;

    events.forEach((event, index) => {
        message += formatEvent(event, index) + '\n\n';
    });

    message += `<i>Всего найдено: ${events.length} событий</i>`;

    return message;
}

/**
 * Format a page of events for the bot
 */
export function formatEventsPage(events, cityName, category, page, hasMore) {
    const categoryNames = {
        'exhibition': '🖼️ Выставки',
        'concert': '🎵 Концерты',
        'theater': '🎭 Театр',
        'festival': '🎪 Фестивали',
        'education': '📚 Образование',
        'all': '📋 Все мероприятия'
    };

    const dates = getWeekendDatesFormatted();
    const catName = categoryNames[category] || '📋 Мероприятия';

    if (events.length === 0) {
        return `😔 Не нашлось мероприятий в категории "${catName}" в городе ${cityName} на эти выходные.`;
    }

    let message = `${catName}\n📍 <b>${escapeHTML(cityName)}</b> (${dates})\n\n`;

    events.forEach((event, index) => {
        message += formatEvent(event, page * 5 + index) + '\n\n';
    });

    message += `<i>Страница ${page + 1}</i>`;

    return message;
}

// ─── Full Description Fetching ─────────────────────────────────────

/**
 * Fetch full description from a Yandex Afisha event page
 * Extracts from embedded JSON data on the page
 */
export async function fetchFullDescription(url) {
    try {
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html',
                'Accept-Language': 'ru-RU,ru;q=0.9'
            },
            timeout: 15000
        });

        const html = res.data;

        // Try to find description in embedded JSON data
        const descMatch = html.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (descMatch && descMatch[1].length > 15) {
            // Unescape JSON string
            let desc = descMatch[1]
                .replace(/\\n/g, '. ')
                .replace(/\\t/g, ' ')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\')
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .replace(/\.{2,}/g, '.')
                .replace(/\.\s+\./g, '.')
                .trim();

            // Trim to reasonable length
            if (desc.length > 250) {
                desc = desc.substring(0, 247).replace(/\s+\S*$/, '') + '...';
            }

            return desc;
        }

        return '';
    } catch (error) {
        console.error(`Error fetching description from ${url}:`, error.message);
        return '';
    }
}
