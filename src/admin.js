import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchEvents } from './events.js';
import { selectDiverseEvents } from './kudago.js';
import * as gorodzovet from './gorodzovet.js';
import { CITIES, MOVIES, RECIPES } from './config.js';
import { cleanDescription, cleanTitle, escapeHTML } from './textUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POST_IMAGE_PATH = join(__dirname, '..', 'Post', 'telegram-cloud-photo-size-2-5192667404658479432-y.jpg');

// Admin ID from environment
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;

/**
 * Check if user is admin
 */
export function isAdmin(userId) {
    return ADMIN_ID && userId === ADMIN_ID;
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
    const cats = (event.categories || []).map(c => typeof c === 'string' ? c : (c.slug || ''));
    const title = (event.title || event.short_title || '').toLowerCase();

    if (cats.includes('exhibition') || title.includes('выставк') || title.includes('экспозиц')) return '🖼️';
    if (cats.includes('concert') || title.includes('концерт') || title.includes('музык')) return '🎹';
    if (cats.includes('theater') || title.includes('спектакл') || title.includes('театр') || title.includes('мюзикл')) return '🎭';
    if (cats.includes('festival') || title.includes('фестиваль') || title.includes('фест') || cats.includes('party') || title.includes('вечеринк')) return '🎉';
    if (cats.includes('education') || title.includes('лекци') || title.includes('мастер-класс')) return '📚';
    if (cats.includes('quest') || title.includes('квест') || title.includes('квиз')) return '🧩';

    return '✨';
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
Подобрали актуальные мероприятия для спокойного и культурного отдыха в нашей рубрике «Чем заняться на выходных в родном городе» 🗺️

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

        const topEvents = selectDiverseEvents(events, 4);
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
                    const desc = cleanDescription(event.description, 180);
                    if (desc) eventDetails.push(escapeHTML(desc));
                }

                if (event.price && event.price !== 'Цена не указана') {
                    eventDetails.push(escapeHTML(cleanTitle(event.price)));
                }

                if (eventDetails.length > 0) {
                    cityPost += `<blockquote>${eventDetails.join('\n')}</blockquote>\n`;
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

Если хотите узнать больше мероприятий в вашем городе — переходите в наш <a href="https://t.me/kudagoduiobot?start=weekend">бот</a> и увидимся там!`;

    // Safety truncation if still over limit
    if (post.length > 4000) {
        console.warn(`Post is too long (${post.length}), truncating...`);
        // Cut at the last complete event block (before \n\n📍 or \n\nА для тех)
        // to avoid breaking HTML tags
        let truncated = post.substring(0, 3950);
        // Find the last complete block boundary (double newline before emoji/section)
        const lastBlock = truncated.lastIndexOf('\n\n');
        if (lastBlock > 2000) {
            truncated = truncated.substring(0, lastBlock);
        }
        // Close any unclosed HTML tags
        const openTags = [];
        const tagRegex = /<(\/?)(b|a|i|blockquote|code|pre)(?:\s[^>]*)?>/gi;
        let match;
        while ((match = tagRegex.exec(truncated)) !== null) {
            if (match[1] === '/') {
                openTags.pop();
            } else {
                openTags.push(match[2].toLowerCase().replace(/\s.*/, ''));
            }
        }
        // Close tags in reverse order
        for (let i = openTags.length - 1; i >= 0; i--) {
            truncated += `</${openTags[i]}>`;
        }
        post = truncated;
    }

    return post;
}
