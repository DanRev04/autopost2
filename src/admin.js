import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchEvents } from './events.js';
import { selectDiverseEvents, getFallbackDescription } from './kudago.js';
import * as gorodzovet from './gorodzovet.js';
import { CITIES, MOVIES, RECIPES } from './config.js';
import { cleanDescription, cleanTitle, escapeHTML } from './textUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POST_IMAGE_PATH = join(__dirname, '..', 'Post', 'weekend_post.jpg');

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
 * Truncate HTML while preserving tags
 */
function truncateHTML(html, limit) {
    let visibleChars = 0;
    let truncatedHtml = '';
    const tagRegex = /(<[^>]+>)|([^<]+)/g;
    let match;
    
    while ((match = tagRegex.exec(html)) !== null && visibleChars < limit) {
        if (match[1]) {
            truncatedHtml += match[1];
        } else if (match[2]) {
            const remaining = limit - visibleChars;
            if (match[2].length <= remaining) {
                truncatedHtml += match[2];
                visibleChars += match[2].length;
            } else {
                let segment = match[2].substring(0, remaining);
                const lastSpace = segment.lastIndexOf(' ');
                if (lastSpace > remaining * 0.7) {
                    segment = segment.substring(0, lastSpace);
                }
                truncatedHtml += segment;
                visibleChars += segment.length;
                break;
            }
        }
    }
    
    const openTags = [];
    const tagCloseFinder = /<(\/?)(b|a|i|blockquote|code|pre)(?:\s[^>]*)?>/gi;
    let tagMatch;
    while ((tagMatch = tagCloseFinder.exec(truncatedHtml)) !== null) {
        if (tagMatch[1] === '/') {
            openTags.pop();
        } else {
            openTags.push(tagMatch[2].toLowerCase());
        }
    }
    for (let i = openTags.length - 1; i >= 0; i--) {
        truncatedHtml += `</${openTags[i]}>`;
    }
    return truncatedHtml;
}

/**
 * Generate post with events from all cities
 * @param {string} mode - 'full' (~3800), 'medium' (~2048), or 'short' (~1024)
 */
export async function generatePost(mode = 'full') {
    const isShort = mode === 'short';
    const isMedium = mode === 'medium';
    
    // Select movie and recipe based on current week
    // Shift by 4 days so rotation happens on Monday (Jan 5 1970 was first Monday)
    const MONDAY_OFFSET = 4 * 24 * 60 * 60 * 1000;
    const weekIndex = Math.floor((Date.now() + MONDAY_OFFSET) / (7 * 24 * 60 * 60 * 1000));
    const movie = MOVIES[weekIndex % MOVIES.length];
    const recipe = RECIPES[weekIndex % RECIPES.length];

    let post = '';
    
    if (isShort || isMedium) {
        post += `Дорогие коллеги 👋 самое время подумать о выходных!\nПодобрали для вас интересные мероприятия 🗺️\n\n`;
    } else {
        post += `Дорогие коллеги 👋\nРабочая неделя почти закончилась, а значит самое время подумать о выходных и провести их с пользой и удовольствием 💙\nПодобрали актуальные мероприятия для спокойного и культурного отдыха в нашей рубрике «Чем заняться на выходных в родном городе» 🗺️\n\n`;
    }

    // Parallel fetch for all cities
    const cityResults = await Promise.all(Object.entries(CITIES).map(async ([slug, city]) => {
        let cityPost = '';
        let events = [];

        try {
            events = await fetchEvents(slug);
        } catch (error) {
            console.error(`Error fetching events for ${slug}:`, error.message);
        }

        // 3 events for 'medium' and 'full', 1 for 'short'
        const countPerCity = isShort ? 1 : 3;
        const topEvents = selectDiverseEvents(events, countPerCity);
        
        if (topEvents.length > 0) {
            // Fetch full descriptions only for non-short modes and specific cities
            if (!isShort && (slug === 'smr' || slug === 'sim')) {
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

            // City Header (Bold)
            if (isShort) {
                cityPost += `📍 <b>${escapeHTML(city.name)}</b>: `;
            } else {
                cityPost += `📍 <b>${escapeHTML(city.name)}</b>\n`;
            }

            topEvents.forEach((event, i) => {
                const emoji = getEventEmoji(event);
                const title = event.short_title || event.title || 'Мероприятие';
                const url = event.site_url || event.url || '';
                const cleanedTitle = cleanTitle(title);
                
                let price = event.price;
                if (!price || price === 'Цена не указана' || price === '0') {
                    price = 'вход свободный';
                }
                const formattedPrice = cleanTitle(price);

                // Format: Title (Price) - price outside of link, with zero-width space to prevent link bleed
                // and another ZWSP inside the price to prevent phone number detection (e.g. 300-1000)
                const sanitizedPrice = escapeHTML(formattedPrice).replace(/-/g, '&#8203;-&#8203;');
                const formattedTitle = url ? `<a href="${url}">${escapeHTML(cleanedTitle)}</a>&#8203; (${sanitizedPrice})` : `${escapeHTML(cleanedTitle)} (${sanitizedPrice})`;

                if (isShort) {
                    cityPost += `${emoji} ${formattedTitle}${i < topEvents.length - 1 ? ', ' : ''}`;
                } else if (isMedium) {
                    // Medium mode: Titles with prices
                    cityPost += `${emoji} ${formattedTitle}\n`;
                } else {
                    // Full mode: Titles + Blockquote descriptions
                    cityPost += `\n${emoji} ${formattedTitle}\n`;
                    let desc = event.description || getFallbackDescription(event);
                    let cleanDesc = cleanDescription(desc, 100);
                    if (!cleanDesc && desc) {
                        cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                        if (cleanDesc.length > 100) cleanDesc = cleanDesc.substring(0, 97) + '...';
                    }
                    if (!cleanDesc) cleanDesc = getFallbackDescription(event);
                    cityPost += `<blockquote>${escapeHTML(cleanDesc)}</blockquote>\n`;
                }
            });
            if (isShort || isMedium) cityPost += '\n';
        }
        return cityPost;
    }));

    post += cityResults.join('');

    const movieTitleClean = movie.title.replace(/[«»]/g, '');
    const movieLink = `<a href="${escapeHTML(movie.url)}">${escapeHTML(movieTitleClean)}</a>`;
    const recipeLink = `<a href="${escapeHTML(recipe.url)}">${escapeHTML(recipe.title)}</a>`;

    if (isShort) {
        post += `🎬 ${movieLink}\n🍰 ${recipeLink}\n\n<a href="https://t.me/kudagoduiobot?start=weekend">Больше</a> ✨`;
    } else {
        const movieDesc = cleanDescription(movie.desc, 150) || movie.desc.replace(/\.+$/, '.');
        post += `\n🏠 <b>Если не хотите выходить из дома:</b>\n🎬 Посмотреть фильм «${movieLink}» — ${escapeHTML(movieDesc)}\n🍰 ${recipeLink} — рецепт\n\n<a href="https://t.me/kudagoduiobot?start=weekend">Больше</a> ✨`;
    }

    // Dynamic safety truncation
    let targetLimit = 3800;
    if (isMedium) targetLimit = 2048;
    if (isShort) targetLimit = 1024;

    const renderedLength = post.replace(/<[^>]+>/g, '').length;
    if (renderedLength > targetLimit) {
        console.warn(`Post mode ${mode} is too long (${renderedLength}), truncating to ${targetLimit}...`);
        post = truncateHTML(post, targetLimit);
    }

    return post;
}
