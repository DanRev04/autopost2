import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchEvents } from './events.js';
import { selectDiverseEvents } from './yandexAfisha.js';
import * as gorodzovet from './gorodzovet.js';
import { CITIES, MOVIES, RECIPES } from './config.js';
import { cleanDescription, cleanTitle, escapeHTML } from './textUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POST_IMAGE_PATH = join(__dirname, '..', 'Post', 'telegram-cloud-photo-size-2-5192667404658479432-y.jpg');

// Admin IDs from environment (supports multiple comma-separated IDs)
const ADMIN_IDS = process.env.ADMIN_ID
    ? process.env.ADMIN_ID.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
    : [];

/**
 * Check if user is admin
 */
export function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

/**
 * Get post image path
 */
export function getPostImagePath() {
    return POST_IMAGE_PATH;
}

/**
 * Get custom emoji matching the event type
 */
function getEventEmoji(event) {
    // Check event categories
    const cats = (event.categories || []).map(c => typeof c === 'string' ? c : (c.slug || ''));

    // We use standard Unicode emojis instead of <tg-emoji> because 
    // standard bots cannot send custom premium emojis without special permissions.
    // If the channel requires custom emojis, it must be sent by a user, 
    // or the bot needs to be linked to a premium account.
    function ce(id, fallback) {
        return fallback;
    }

    // Match by category
    if (cats.includes('exhibition')) return ce('5375074927252621134', '🖼️');
    if (cats.includes('concert')) return ce('5467398680959023683', '🎹');
    if (cats.includes('theater')) return ce('5359441070201513074', '🎭');
    if (cats.includes('festival')) return ce('5193018401810822951', '🎉');
    if (cats.includes('education')) return ce('5373098009640836781', '📚');
    if (cats.includes('party')) return ce('5193018401810822951', '🎉');
    if (cats.includes('quest')) return ce('5213306719215577669', '🧩');

    // Fallback: detect from title for GorodZovet events
    const title = (event.title || event.short_title || '').toLowerCase();
    if (title.includes('выставк') || title.includes('экспозиц')) return ce('5375074927252621134', '🖼️');
    if (title.includes('концерт') || title.includes('музык')) return ce('5467398680959023683', '🎹');
    if (title.includes('спектакл') || title.includes('театр') || title.includes('мюзикл')) return ce('5359441070201513074', '🎭');
    if (title.includes('фестиваль') || title.includes('фест')) return ce('5193018401810822951', '🎉');
    if (title.includes('лекци') || title.includes('мастер-класс')) return ce('5373098009640836781', '📚');
    if (title.includes('вечеринк')) return ce('5193018401810822951', '🎉');
    if (title.includes('квест') || title.includes('квиз')) return ce('5213306719215577669', '🧩');

    return ce('5193018401810822951', '🎉');
}

/**
 * Simple HTML entity decoder
 */
function decodeHTMLEntities(text) {
    if (!text) return '';
    return text
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

/**
 * Escape HTML special characters
 */

/**
 * Generate full post with events from all cities
 */
export async function generatePost() {
    // Select movie and recipe based on current week for variety and consistency
    const weekIndex = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    const movie = MOVIES[weekIndex % MOVIES.length];
    const recipe = RECIPES[weekIndex % RECIPES.length];

    let post = `Дорогие коллеги 👋
Рабочая неделя почти закончилась, а значит самое время подумать о выходных и провести их с пользой и удовольствием 💙
Запускаем новую рубрику «Чем заняться на выходных в родном городе» 🗺️
Подобрали актуальные мероприятия для спокойного и культурного отдыха.

`;

    // Parallel fetch for all cities
    const cityResults = await Promise.all(Object.entries(CITIES).map(async ([slug, city]) => {
        let cityPost = `📍 <b>${escapeHTML(city.name)}</b>\n\n`;
        let events = [];

        try {
            events = await fetchEvents(slug);
        } catch (error) {
            console.error(`Error fetching events for ${slug}:`, error.message);
        }

        const topEvents = selectDiverseEvents(events, 3);
        if (topEvents.length === 0) {
            cityPost += `Мероприятия уточняются.\n\n`;
        } else {
            // Parallel fetch full descriptions only for GorodZovet cities
            if (slug === 'smr' || slug === 'sim') {
                await Promise.all(topEvents.map(async (event) => {
                    if (event.url && !event.description_fetched) {
                        const fullDesc = await gorodzovet.fetchFullDescription(event.url);
                        if (fullDesc) {
                            event.description = fullDesc;
                            event.description_fetched = true;
                        }
                    }
                }));
            }

            topEvents.forEach((event, i) => {
                const emoji = getEventEmoji(event);
                const title = event.short_title || event.title || 'Мероприятие';
                const url = event.site_url || event.url || '';
                const cleanedTitle = cleanTitle(title);
                const formattedTitle = url ? `<a href="${url}">${escapeHTML(cleanedTitle)}</a>` : escapeHTML(cleanedTitle);

                cityPost += `${emoji} ${formattedTitle}\n`;

                let eventDetails = [];
                if (event.description) {
                    const desc = cleanDescription(event.description, 250);
                    if (desc) eventDetails.push(escapeHTML(desc));
                }

                if (event.price && event.price !== 'Цена не указана') {
                    eventDetails.push(escapeHTML(cleanTitle(event.price)));
                }

                if (eventDetails.length > 0) {
                    cityPost += `<blockquote expandable>${eventDetails.join('\n')}</blockquote>\n`;
                }

                cityPost += '\n';
            });
        }
        return cityPost;
    }));

    post += cityResults.join('');

    const cleanedMovieTitle = cleanTitle(movie.title.replace(/[«»]/g, ''));
    const movieLink = `<a href="${escapeHTML(movie.url)}">${escapeHTML(cleanedMovieTitle)}</a>`;
    const recipeLink = `<a href="${escapeHTML(recipe.url)}">рецепт</a>`;

    const movieDesc = cleanDescription(movie.desc, 100) || movie.desc.replace(/\.+$/, '.');
    post += `А для тех, кто просто хочет отдохнуть от рабочей недели, мы подготовили домашние активности 🔥
🎬 Посмотреть фильм «${movieLink}» - ${escapeHTML(movieDesc)}
🍰 ${escapeHTML(cleanTitle(recipe.title))} - ${recipeLink}
🧘‍♀️ Прогулка в парках - дышим свежим воздухом

Пусть выходные пройдут тепло, интересно и с пользой ✨

<b>Если хотите узнать больше о мероприятиях в вашем городе — переходите в наш <a href="https://t.me/kudagoduiobot?start=weekend">бот</a> и увидимся там!</b>`;

    return post;
}
