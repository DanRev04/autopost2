import axios from 'axios';
import { FILTERS, HOLIDAYS } from './config.js';
import { cleanTitle, cleanDescription, escapeHTML } from './textUtils.js';

const BASE_URL = 'https://gorodzovet.ru';

/**
 * Get upcoming weekend dates
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

    const dates = [];
    for (let i = 0; i < 3; i++) { // Friday, Saturday, Sunday
        const date = new Date(now);
        date.setDate(now.getDate() + daysUntilFriday + i);
        dates.push({
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate()
        });
    }

    return dates;
}

/**
 * Decode Unicode escape sequences
 */
function decodeUnicode(str) {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, code) => {
        return String.fromCharCode(parseInt(code, 16));
    });
}

/**
 * Parse events from API HTML response
 */
function parseEventsFromApiHtml(htmlItems) {
    if (!Array.isArray(htmlItems)) {
        console.warn('parseEventsFromApiHtml: htmlItems is not an array', typeof htmlItems);
        return [];
    }
    const events = [];

    for (const item of htmlItems) {
        let html = item.html || '';
        const id = item.id;

        // Decode unicode escapes
        html = decodeUnicode(html);

        // Extract URL from data-link attribute
        const urlMatch = html.match(/data-link="([^"]+event\d+)"/);

        // Extract title from h3 > span
        const titleMatch = html.match(/<h3[^>]*>\s*<span>([^<]+)<\/span>\s*<\/h3>/i) ||
            html.match(/<h3[^>]*>([^<]+)<\/h3>/i);

        // Extract short description from lines4 div
        const descMatch = html.match(/<div[^>]*class="[^"]*lines4[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        let description = '';
        if (descMatch) {
            description = descMatch[1]
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        // Extract price from event-price div
        const priceMatch = html.match(/<div[^>]*class="[^"]*event-price[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        let price = 'Цена не указана';
        if (priceMatch) {
            // Remove SVG tags and clean up
            let priceText = priceMatch[1]
                .replace(/<svg[\s\S]*?<\/svg>/gi, '')
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (priceText) {
                price = priceText + ' ₽';
            }
        }

        if (urlMatch) {
            const url = urlMatch[1];
            let title = titleMatch ? titleMatch[1].trim() : 'Мероприятие';

            // Clean up title - remove extra whitespace
            title = title.replace(/\s+/g, ' ').trim();

            events.push({
                id: String(id),
                title: title,
                description: description,
                price: price,
                url: `${BASE_URL}${url}`
            });
        }
    }

    return events;
}

/**
 * Filter events based on criteria
 */
function filterEvents(events) {
    return events.filter(event => {
        const title = (event.title || '').toLowerCase();
        const description = (event.description || '').toLowerCase();

        const hasExcludedKeyword = FILTERS.excludeKeywords.some(keyword =>
            title.includes(keyword.toLowerCase()) ||
            description.includes(keyword.toLowerCase())
        );

        if (hasExcludedKeyword) return false;

        return !hasExcludedKeyword;
    });
}

/**
 * Sort events by priority (prioritizes one-off events like concerts and theater)
 */
function sortEvents(events) {
    const oneOffKeywords = ['концерт', 'мюзикл', 'спектакль', 'фестиваль', 'вечеринка', 'лекция', 'мастер-класс'];
    const permanentKeywords = ['выставка', 'экспозиция', 'экскурсия'];

    return events.sort((a, b) => {
        const aTitle = (a.title || '').toLowerCase();
        const bTitle = (b.title || '').toLowerCase();

        // Check if event is one-off
        const aIsOneOff = oneOffKeywords.some(k => aTitle.includes(k));
        const bIsOneOff = oneOffKeywords.some(k => bTitle.includes(k));

        if (aIsOneOff && !bIsOneOff) return -1;
        if (!aIsOneOff && bIsOneOff) return 1;

        // Check if event is permanent
        const aIsPermanent = permanentKeywords.some(k => aTitle.includes(k));
        const bIsPermanent = permanentKeywords.some(k => bTitle.includes(k));

        if (aIsPermanent && !bIsPermanent) return 1;
        if (!aIsPermanent && bIsPermanent) return -1;

        return 0;
    });
}

/**
 * Fetch events from GorodZovet API for a specific date
 */
async function fetchEventsForDate(citySlug, dateInfo) {
    const url = `${BASE_URL}/api/events/`;
    const params = {
        city: citySlug,
        year: dateInfo.year,
        month_number: dateInfo.month,
        day: dateInfo.day,
        page_type: 'day'
    };

    try {
        const response = await axios.get(url, {
            params,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${BASE_URL}/${citySlug}/`
            },
            timeout: 60000
        });

        if (response.data && response.data.events) {
            return parseEventsFromApiHtml(response.data.events);
        }

        return [];
    } catch (error) {
        console.error(`❌ GorodZovet Error (${citySlug}, ${dateInfo.day}):`, error.message);
        if (error.response) {
            console.error(`  Status: ${error.response.status}`);
            console.error(`  Headers:`, JSON.stringify(error.response.headers));
        }
        return [];
    }
}

/**
 * Fetch weekend events from GorodZovet
 */
export async function fetchGorodZovetEvents(citySlug) {
    const dates = getWeekendDates();
    const allEvents = [];
    const seenIds = new Set();

    console.log(`Fetching events for ${citySlug}...`);

    for (const dateInfo of dates) {
        const events = await fetchEventsForDate(citySlug, dateInfo);
        console.log(`  Date ${dateInfo.day}: found ${events.length} events`);

        for (const event of events) {
            if (!seenIds.has(event.id)) {
                seenIds.add(event.id);
                allEvents.push(event);
            }
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Filter, sort and limit events
    let filtered = filterEvents(allEvents);
    const sorted = sortEvents(filtered);

    console.log(`Total: ${allEvents.length} events, after filter: ${sorted.length}`);
    return sorted.slice(0, FILTERS.maxEvents);
}

/**
 * Fetch GorodZovet events by category with pagination
 */
export async function fetchGZEventsByCategory(citySlug, category, page = 0, perPage = 5) {
    try {
        const allEvents = await fetchGorodZovetEvents(citySlug);

        // Filter by category using title keywords
        let categoryEvents;
        if (category === 'all') {
            categoryEvents = allEvents;
        } else {
            categoryEvents = allEvents.filter(event => {
                const title = (event.title || '').toLowerCase();
                switch (category) {
                    case 'exhibition': return title.includes('выставк') || title.includes('экспозиц');
                    case 'concert': return title.includes('концерт') || title.includes('музык');
                    case 'theater': return title.includes('спектакл') || title.includes('театр') || title.includes('мюзикл');
                    case 'festival': return title.includes('фестиваль') || title.includes('фест');
                    case 'education': return title.includes('лекци') || title.includes('мастер-класс');
                    default: return true;
                }
            });
        }

        const start = page * perPage;
        const end = start + perPage;
        const pageEvents = categoryEvents.slice(start, end);
        const hasMore = end < categoryEvents.length && page < 5;

        return { events: pageEvents, hasMore };
    } catch (error) {
        console.error(`❌ GorodZovet category Error (${citySlug}/${category}):`, error.message);
        return { events: [], hasMore: false };
    }
}

/**
 * Format events for Telegram message (HTML mode)
 */
export function formatGorodZovetMessage(events, cityName) {
    if (events.length === 0) {
        return `😔 К сожалению, не нашлось подходящих мероприятий в городе ${cityName} на эти выходные.`;
    }

    const dates = getGZWeekendDatesFormatted();
    let message = `🎉 <b>Мероприятия ${dates} в городе ${escapeHTML(cityName)}:</b>\n\n`;

    events.forEach((event, index) => {
        const title = event.title || 'Без названия';
        const cleanedTitle = cleanTitle(title);
        const price = event.price || 'Цена не указана';
        message += `${index + 1}. <a href="${escapeHTML(event.url)}">${escapeHTML(cleanedTitle)}</a>\n`;

        // Build blockquote content
        let details = [];

        let desc = '';
        if (event.description) {
            desc = cleanDescription(event.description, 120);
        }
        if (!desc) {
            desc = getGorodZovetFallbackDesc(title);
        }
        if (desc) details.push(escapeHTML(desc));

        details.push(`💰 ${escapeHTML(price)}`);

        message += `<blockquote expandable>${details.join('\n')}</blockquote>\n\n`;
    });

    message += `<i>Всего найдено: ${events.length} событий</i>`;

    return message;
}

/**
 * Format weekend dates for GorodZovet
 */
function getGZWeekendDatesFormatted() {
    const now = new Date();
    const dayOfWeek = now.getDay();

    let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
    if (daysUntilFriday === 0 && now.getHours() >= 18) daysUntilFriday = 0;
    else if (dayOfWeek === 6) daysUntilFriday = -1;
    else if (dayOfWeek === 0) daysUntilFriday = -2;

    const friday = new Date(now);
    friday.setDate(now.getDate() + daysUntilFriday);
    friday.setHours(0, 0, 0, 0);

    const sunday = new Date(friday);
    sunday.setDate(friday.getDate() + 2);

    // Check for holiday helpers
    const isHol = (d) => {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return HOLIDAYS.includes(`${mm}-${dd}`);
    };

    // Extend backwards for holidays before Friday
    let startDate = new Date(friday);
    for (let i = 1; i <= 5; i++) {
        const prev = new Date(friday);
        prev.setDate(friday.getDate() - i);
        if (isHol(prev)) startDate = prev;
        else break;
    }

    // Extend forwards for holidays after Sunday
    let endDate = new Date(sunday);
    for (let i = 1; i <= 5; i++) {
        const next = new Date(sunday);
        next.setDate(sunday.getDate() + i);
        if (isHol(next)) endDate = next;
        else break;
    }

    const pad = n => String(n).padStart(2, '0');
    const startStr = `${pad(startDate.getDate())}.${pad(startDate.getMonth() + 1)}`;
    const endStr = `${pad(endDate.getDate())}.${pad(endDate.getMonth() + 1)}`;

    return `с ${startStr} - ${endStr}`;
}

/**
 * Generate fallback description based on event title
 */
function getGorodZovetFallbackDesc(title) {
    const t = (title || '').toLowerCase();
    if (t.includes('выставк') || t.includes('экспозиц')) return 'Выставка с интересными экспонатами и уникальными работами';
    if (t.includes('концерт') || t.includes('музык')) return 'Живое музыкальное выступление для ценителей хорошего звука';
    if (t.includes('спектакл') || t.includes('театр') || t.includes('мюзикл')) return 'Театральная постановка для яркого культурного вечера';
    if (t.includes('фестиваль') || t.includes('фест')) return 'Фестиваль с разнообразной программой и активностями';
    if (t.includes('лекци') || t.includes('мастер-класс')) return 'Познавательное мероприятие для расширения кругозора';
    if (t.includes('квест') || t.includes('квиз')) return 'Увлекательное интерактивное приключение';
    return 'Интересное мероприятие для культурного отдыха';
}

/**
 * Fetch full description from event page
 */
export async function fetchFullDescription(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                'Accept': 'text/html',
                'Referer': 'https://gorodzovet.ru/'
            },
            timeout: 15000
        });

        const html = response.data;
        // Extract content from .eventText div, matching until the next major section (footer or similar events)
        // This is more robust against nested divs in minified HTML
        const match = html.match(/<div[^>]*class=["']?eventText["']?[^>]*>([\s\S]*?)(?:<h2[^>]*>похожие мероприятия|<\/footer>)/i);
        if (match) {
            return match[1]
                .replace(/(?:<br\s*\/?>\s*)+/gi, '. ') // Turn sequences of line breaks into a single period
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .replace(/\.\s+\./g, '. ') // Remove ". . " patterns
                .replace(/\.{2,}/g, '.')
                .trim();
        }
        return '';
    } catch (error) {
        console.error(`Error fetching full description from ${url}:`, error.message);
        return '';
    }
}

