import axios from 'axios';
import { KUDAGO, FILTERS, HOLIDAYS } from './config.js';
import { cleanTitle, cleanDescription, escapeHTML } from './textUtils.js';

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
 * E.g. if Thursday is a holiday → Thu-Sun; if Monday is a holiday → Fri-Mon
 */
function getWeekendDates() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday

    // Calculate days until Friday
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

    // Extend start backwards if days before Friday are holidays
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

    // Extend end forwards if days after Sunday are holidays
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

    startDate.setHours(17, 0, 0, 0); // Start from evening of first day
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
 * Parse price from KudaGo format
 */
function parsePrice(priceStr) {
    if (!priceStr || priceStr.toLowerCase().includes('бесплатно') || priceStr.toLowerCase().includes('free')) {
        return 0;
    }

    // Extract numbers from price string
    const numbers = priceStr.match(/\d+/g);
    if (numbers && numbers.length > 0) {
        // Return the minimum price if range is given
        return parseInt(numbers[0], 10);
    }

    return null; // Unknown price
}

/**
 * Calculate event duration in days
 */
function getEventDuration(event) {
    if (!event.dates || event.dates.length === 0) return 0;

    // Find the longest date range among the entries
    let maxDuration = 0;
    event.dates.forEach(d => {
        const duration = (d.end - d.start) / 86400; // duration in days
        if (duration > maxDuration) maxDuration = duration;
    });
    return maxDuration;
}

/**
 * Check if event is recurring (has many date entries, indicating it repeats regularly)
 */
function isRecurringEvent(event) {
    if (!event.dates) return false;
    // Events with 5+ date entries are likely recurring (weekly, etc.)
    return event.dates.length >= 5;
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
 * Filter events based on criteria
 */
function filterEvents(events) {
    return events.filter(event => {
        // Exclude 18+ events by age restriction
        if (event.age_restriction === '18+') return false;

        // Check for excluded keywords in title
        const title = (event.title || '').toLowerCase();
        const shortTitle = (event.short_title || '').toLowerCase();
        const description = (event.description || '').toLowerCase();

        const hasExcludedKeyword = FILTERS.excludeKeywords.some(keyword =>
            title.includes(keyword.toLowerCase()) ||
            shortTitle.includes(keyword.toLowerCase()) ||
            description.includes(keyword.toLowerCase())
        );

        if (hasExcludedKeyword) return false;

        // Check price
        const price = parsePrice(event.price);
        if (price !== null && price > FILTERS.maxPrice) return false;

        return true;
    });
}

/**
 * Sort events by priority with weekly rotation
 * - Deprioritizes recurring events (weekly quizzes, etc.)
 * - Uses week-based seed to show different events each week
 */
function sortEvents(events) {
    const weekSeed = getWeekSeed();
    const rng = seededRandom(weekSeed);

    // Assign a random score to each event for this week
    const scored = events.map(event => {
        let score = 0;

        // Events with images get a bonus
        if (event.images && event.images.length > 0) score += 10;

        // Recurring events get a significant penalty
        if (isRecurringEvent(event)) score -= 15;

        // Long-running events get a smaller penalty
        const duration = getEventDuration(event);
        if (duration > 7) score -= 5;

        // Add weekly randomness (0 to 8 points)
        score += rng() * 8;

        return { event, score };
    });

    // Sort by score descending (highest score first)
    scored.sort((a, b) => b.score - a.score);

    return scored.map(s => s.event);
}

/**
 * Fetch events for a single category from KudaGo API
 */
async function fetchCategoryEvents(citySlug, category, dates) {
    try {
        const response = await axios.get(`${KUDAGO.baseUrl}/events/`, {
            params: {
                location: citySlug,
                actual_since: dates.since,
                actual_until: dates.until,
                categories: category,
                page_size: 10,
                fields: KUDAGO.fields,
                order_by: '-publication_date'
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            },
            timeout: 30000
        });
        return response.data.results || [];
    } catch (error) {
        console.error(`❌ KudaGo Error (${citySlug}/${category}):`, error.message);
        return [];
    }
}

/**
 * Fetch events from KudaGo API — per-category for diversity
 */
export async function fetchEvents(citySlug) {
    const dates = getWeekendDates();
    const targetCategories = ['exhibition', 'concert', 'theater', 'festival', 'education'];

    try {
        // Fetch each category in parallel
        const categoryResults = await Promise.all(
            targetCategories.map(cat => fetchCategoryEvents(citySlug, cat, dates))
        );

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

        console.log(`KudaGo ${citySlug}: fetched ${allEvents.length} events across ${targetCategories.length} categories`);

        // Limit to max events
        return allEvents.slice(0, FILTERS.maxEvents);
    } catch (error) {
        console.error(`❌ KudaGo Error (${citySlug}):`, error.message);
        return [];
    }
}

/**
 * Determine the event type from its categories or title
 * Checks ALL category tags, not just the first one
 * Also detects type from title for sources without category data (GorodZovet)
 */
function getEventType(event) {
    // Target types we want to diversify across
    const targetTypes = ['exhibition', 'concert', 'theater', 'festival', 'education', 'party', 'quest'];

    // Check KudaGo categories array
    if (event.categories && event.categories.length > 0) {
        for (const cat of event.categories) {
            const slug = (typeof cat === 'string') ? cat : (cat.slug || '');
            if (targetTypes.includes(slug)) return slug;
        }
    }

    // Fallback: detect from title/description for GorodZovet or untagged events
    const title = (event.title || event.short_title || '').toLowerCase();
    if (title.includes('выставк') || title.includes('экспозиц')) return 'exhibition';
    if (title.includes('концерт') || title.includes('музык')) return 'concert';
    if (title.includes('спектакл') || title.includes('театр') || title.includes('мюзикл')) return 'theater';
    if (title.includes('фестиваль') || title.includes('фест')) return 'festival';
    if (title.includes('лекци') || title.includes('мастер-класс')) return 'education';
    if (title.includes('вечеринк') || title.includes('party')) return 'party';
    if (title.includes('квест') || title.includes('квиз')) return 'quest';

    return 'other';
}

/**
 * Select diverse events ensuring different categories are represented
 * Picks one event from each type, rotating priority weekly
 * @param {Array} events - sorted events list
 * @param {number} count - how many events to pick
 * @returns {Array} diverse selection of events
 */
export function selectDiverseEvents(events, count = 3) {
    if (events.length <= count) return events;

    // Define category priority (rotate which types get picked each week)
    const allTypes = ['exhibition', 'concert', 'theater', 'festival', 'education', 'party', 'quest'];
    const weekSeed = getWeekSeed();

    // Rotate priority each week
    const startIdx = weekSeed % allTypes.length;
    const rotatedTypes = [
        ...allTypes.slice(startIdx),
        ...allTypes.slice(0, startIdx)
    ];

    // Group events by type
    const byType = {};
    for (const event of events) {
        const type = getEventType(event);
        if (!byType[type]) byType[type] = [];
        byType[type].push(event);
    }

    console.log('📊 Event type distribution:', Object.keys(byType).map(k => `${k}: ${byType[k].length}`).join(', '));

    const selected = [];
    const usedIds = new Set();

    // Pick one event from each type in priority order
    for (const type of rotatedTypes) {
        if (selected.length >= count) break;
        if (byType[type] && byType[type].length > 0) {
            const event = byType[type].shift();
            if (!usedIds.has(event.id)) {
                selected.push(event);
                usedIds.add(event.id);
                console.log(`  ✅ Picked [${type}]: ${event.short_title || event.title}`);
            }
        }
    }

    // Fill remaining slots from the sorted list (avoiding duplicates and same types)
    const usedTypes = new Set(selected.map(e => getEventType(e)));
    if (selected.length < count) {
        // First try to fill with unused types
        for (const event of events) {
            if (selected.length >= count) break;
            const type = getEventType(event);
            if (!usedIds.has(event.id) && !usedTypes.has(type)) {
                selected.push(event);
                usedIds.add(event.id);
                usedTypes.add(type);
                console.log(`  ✅ Filled [${type}]: ${event.short_title || event.title}`);
            }
        }
    }

    // If still not enough, fill with any remaining events
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

/**
 * Format event for Telegram message (HTML mode)
 */
function formatEvent(event, index) {
    const title = event.short_title || event.title || 'Без названия';
    const cleanedTitle = cleanTitle(title);
    const price = event.price || 'Цена не указана';
    const url = event.site_url || `https://kudago.com/msk/event/${event.id}/`;

    let text = `${index + 1}. <a href="${escapeHTML(url)}">${escapeHTML(cleanedTitle)}</a>\n`;

    // Build blockquote content with description + price + place
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
        'party': 'Яркое событие для отличного настроения',
        'quest': 'Увлекательное интерактивное приключение',
        'other': 'Интересное мероприятие для культурного отдыха'
    };
    return fallbacks[type] || fallbacks['other'];
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
 * Fetch events by specific category with pagination
 * @param {string} citySlug - city slug (msk, spb)
 * @param {string} category - category slug (concert, theater, exhibition, festival, education) or 'all'
 * @param {number} page - page number (0-based)
 * @param {number} perPage - events per page
 * @returns {Object} { events: [], hasMore: boolean }
 */
export async function fetchEventsByCategory(citySlug, category, page = 0, perPage = 5) {
    const dates = getWeekendDates();

    try {
        let allEvents;

        if (category === 'all') {
            // Fetch all categories
            const targetCategories = ['exhibition', 'concert', 'theater', 'festival', 'education'];
            const categoryResults = await Promise.all(
                targetCategories.map(cat => fetchCategoryEvents(citySlug, cat, dates))
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
            // Fetch single category with larger page size for pagination
            const response = await axios.get(`${KUDAGO.baseUrl}/events/`, {
                params: {
                    location: citySlug,
                    actual_since: dates.since,
                    actual_until: dates.until,
                    categories: category,
                    page_size: 40,
                    fields: KUDAGO.fields,
                    order_by: '-publication_date'
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                },
                timeout: 30000
            });
            allEvents = response.data.results || [];
        }

        // Apply filters and sort
        allEvents = filterEvents(allEvents);
        allEvents = sortEvents(allEvents);

        // Paginate
        const start = page * perPage;
        const end = start + perPage;
        const pageEvents = allEvents.slice(start, end);
        const hasMore = end < allEvents.length && page < 5; // max 6 pages (0-5)

        return { events: pageEvents, hasMore };
    } catch (error) {
        console.error(`❌ KudaGo category Error (${citySlug}/${category}):`, error.message);
        return { events: [], hasMore: false };
    }
}

/**
 * Format a page of events for the bot (with blockquote)
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
