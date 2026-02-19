import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { CITIES } from './config.js';
import {
    initDatabase,
    getUser,
    setUserCity,
    subscribeUser,
    unsubscribeUser
} from './database.js';
import { fetchEvents, formatEventsMessage, fetchEventsByCategory, formatEventsPage } from './events.js';
import { startScheduler } from './scheduler.js';
import { isAdmin, generatePost, getPostImagePath } from './admin.js';
import { readFileSync } from 'fs';

// Check for bot token
if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required in .env file');
    process.exit(1);
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Debug middleware to log all incoming updates
bot.use(async (ctx, next) => {
    console.log(`📥 Incoming update [${ctx.updateType}]:`, JSON.stringify(ctx.update, null, 2));
    try {
        await next();
    } catch (err) {
        console.error('❌ Update Error:', err);
    }
});

/**
 * Create city selection keyboard
 */
function getCityKeyboard() {
    const buttons = Object.entries(CITIES).map(([slug, city]) =>
        Markup.button.callback(`${city.emoji} ${city.name}`, `city:${slug}`)
    );

    return Markup.inlineKeyboard(buttons, { columns: 2 });
}

/**
 * Persistent reply keyboard (above text input)
 */
const mainKeyboard = Markup.keyboard([
    ['🎉 Мероприятия', '🔔 Подписка'],
    ['❓ Помощь']
]).resize();

/**
 * /start command - Welcome message with city selection
 */
bot.command('start', async (ctx) => {
    const payload = ctx.startPayload;
    const user = getUser(ctx.from.id, ctx.from.username);

    if (payload === 'weekend') {
        await ctx.reply('🏙️ Выбери город, чтобы посмотреть мероприятия на выходные:', getCityKeyboard());
    } else {
        await ctx.reply(
            `👋 Привет, ${ctx.from.first_name || 'друг'}!\n\n` +
            `Я помогу тебе найти интересные мероприятия на предстоящие выходные.\n\n` +
            `📌 Как пользоваться:\n` +
            `1️⃣ Выбери город\n` +
            `2️⃣ Выбери категорию (выставки, концерты, театр и др.)\n` +
            `3️⃣ Листай страницы с мероприятиями\n\n` +
            `🏙️ Для начала выбери свой город:`,
            { ...getCityKeyboard(), ...mainKeyboard }
        );
    }
});

/**
 * Handle persistent keyboard button presses
 */
bot.hears('🎉 Мероприятия', async (ctx) => {
    await ctx.reply('🏙️ Выбери город:', getCityKeyboard());
});

bot.hears('🔔 Подписка', async (ctx) => {
    const user = getUser(ctx.from.id, ctx.from.username);
    const city = CITIES[user.city_slug] || CITIES.msk;

    subscribeUser(ctx.from.id);

    await ctx.reply(
        `✅ Ты подписался на еженедельную рассылку!\n\n` +
        `📍 Город: ${city.emoji} ${city.name}\n` +
        `📅 Рассылка приходит по пятницам в 10:00\n\n` +
        `Чтобы отписаться, используй /unsubscribe`
    );
});

bot.hears('❓ Помощь', async (ctx) => {
    let helpText = `🤖 Команды бота:\n\n` +
        `🎉 Мероприятия - Выбрать город и категорию\n` +
        `🔔 Подписка - Подписаться на рассылку\n` +
        `/unsubscribe - Отписаться от рассылки\n` +
        `/start - Начать заново`;

    await ctx.reply(helpText);
});

/**
 * /weekend command - Show city selection
 */
bot.command('weekend', async (ctx) => {
    await ctx.reply('🏙️ Выбери город, чтобы посмотреть мероприятия на выходные:', getCityKeyboard());
});

/**
 * /subscribe command - Subscribe to weekly notifications
 */
bot.command('subscribe', async (ctx) => {
    const user = getUser(ctx.from.id, ctx.from.username);
    const city = CITIES[user.city_slug] || CITIES.msk;

    subscribeUser(ctx.from.id);

    await ctx.reply(
        `✅ Ты подписался на еженедельную рассылку!\n\n` +
        `📍 Город: ${city.emoji} ${city.name}\n` +
        `📅 Рассылка приходит по пятницам в 10:00\n\n` +
        `Чтобы отписаться, используй /unsubscribe`
    );
});

/**
 * /unsubscribe command - Unsubscribe from notifications
 */
bot.command('unsubscribe', async (ctx) => {
    unsubscribeUser(ctx.from.id);

    await ctx.reply(
        `❌ Ты отписался от рассылки.\n\n` +
        `Если передумаешь, используй /subscribe`
    );
});

/**
 * /generate command - Admin only: Generate post with events
 */
bot.command('generate', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('⛔ Эта команда доступна только администратору.');
        return;
    }

    await ctx.reply('⏳ Генерирую пост. Это может занять несколько секунд.');

    try {
        const postText = await generatePost();
        const imagePath = getPostImagePath();

        try {
            // "Hidden Link" trick for long posts with photo
            // Using HTML format for cleaner text escaping
            const IMAGE_URL = 'https://files.catbox.moe/kh2qko.jpg';
            const postWithPhoto = `<a href="${IMAGE_URL}">&#8203;</a>${postText}`;

            await ctx.reply(postWithPhoto, {
                parse_mode: 'HTML',
                link_preview_options: {
                    is_disabled: false,
                    show_above_text: true,
                    url: IMAGE_URL
                }
            });
        } catch (error) {
            console.error('❌ Sending Error:', error.message);
            // Fallback: send text only
            await ctx.reply(postText, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        }

        await ctx.reply('✅ Пост сгенерирован!');
    } catch (error) {
        console.error('❌ Generator Error:', error);
        if (error.response && error.response.description) {
            console.error('❌ Telegram Response:', error.response.description);
            await ctx.reply(`❌ Ошибка Telegram: ${error.response.description}`);
        } else {
            await ctx.reply(`❌ Ошибка: ${error.message}`);
        }
    }
});

/**
 * /help command
 */
bot.command('help', async (ctx) => {
    let helpText = `🤖 *Команды бота:*\n\n` +
        `/start - Выбрать город\n` +
        `/weekend - Мероприятия на выходные\n` +
        `/subscribe - Подписаться на рассылку\n` +
        `/unsubscribe - Отписаться от рассылки\n` +
        `/help - Справка`;

    if (isAdmin(ctx.from.id)) {
        helpText += `\n\n🔐 *Команды админа:*\n` +
            `/generate - Сгенерировать пост`;
    }

    await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

/**
 * Category selection keyboard
 */
function getCategoryKeyboard(citySlug) {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🖼️ Выставки', `cat:${citySlug}:exhibition:0`),
        Markup.button.callback('🎵 Концерты', `cat:${citySlug}:concert:0`)],
        [Markup.button.callback('🎭 Театр', `cat:${citySlug}:theater:0`),
        Markup.button.callback('🎪 Фестивали', `cat:${citySlug}:festival:0`)],
        [Markup.button.callback('📚 Образование', `cat:${citySlug}:education:0`),
        Markup.button.callback('📋 Все', `cat:${citySlug}:all:0`)]
    ]);
}

/**
 * City selection callback handler — show category buttons
 */
bot.action(/^city:(.+)$/, async (ctx) => {
    const citySlug = ctx.match[1];
    const city = CITIES[citySlug];

    if (!city) {
        await ctx.answerCbQuery('Город не найден');
        return;
    }

    setUserCity(ctx.from.id, citySlug);
    await ctx.answerCbQuery(`${city.emoji} ${city.name} выбран!`);

    await ctx.editMessageText(
        `✅ Выбран город: ${city.emoji} ${city.name}\n🎭 Выбери категорию мероприятий:`,
        getCategoryKeyboard(citySlug)
    );
});

/**
 * Category selection callback handler — fetch and display events
 */
bot.action(/^cat:(.+):(.+):(\d+)$/, async (ctx) => {
    const citySlug = ctx.match[1];
    const category = ctx.match[2];
    const page = parseInt(ctx.match[3]);
    const city = CITIES[citySlug];

    if (!city) {
        await ctx.answerCbQuery('Город не найден');
        return;
    }

    await ctx.answerCbQuery('🔍 Загружаю...');

    try {
        const { events, hasMore } = await fetchEventsByCategory(citySlug, category, page);
        const message = formatEventsPage(events, citySlug, category, page, hasMore);

        // Build pagination buttons
        const buttons = [];
        if (page > 0) {
            buttons.push(Markup.button.callback('⬅️ Назад', `cat:${citySlug}:${category}:${page - 1}`));
        }
        if (hasMore) {
            buttons.push(Markup.button.callback('Далее ➡️', `cat:${citySlug}:${category}:${page + 1}`));
        }
        const backButton = [Markup.button.callback('📍 Категории', `city:${citySlug}`)];

        const keyboard = Markup.inlineKeyboard([
            ...(buttons.length > 0 ? [buttons] : []),
            backButton
        ]);

        if (page === 0 && ctx.callbackQuery.message) {
            // First page — edit the message
            try {
                await ctx.editMessageText(message, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    ...keyboard
                });
            } catch {
                // If edit fails, send new message
                await ctx.reply(message, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    ...keyboard
                });
            }
        } else {
            // Pagination — edit existing message
            try {
                await ctx.editMessageText(message, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    ...keyboard
                });
            } catch {
                await ctx.reply(message, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    ...keyboard
                });
            }
        }
    } catch (error) {
        console.error('Error fetching category events:', error);
        await ctx.reply(`😔 Ошибка при загрузке: ${error.message || 'Неизвестная ошибка'}. Попробуй еще раз.`);
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
});

// Main startup function
async function main() {
    // Initialize database (async)
    await initDatabase();

    // Register bot commands menu
    await bot.telegram.setMyCommands([
        { command: 'start', description: '🏠 Начать — выбрать город и категорию' },
        { command: 'weekend', description: '🎉 Мероприятия на выходные' },
        { command: 'subscribe', description: '🔔 Подписаться на рассылку' },
        { command: 'unsubscribe', description: '🔕 Отписаться от рассылки' },
        { command: 'help', description: '❓ Справка' }
    ]);

    // Start bot
    console.log('🚀 Starting bot...');
    bot.launch();

    // Start scheduler
    startScheduler(bot);

    // Graceful shutdown
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    console.log('✅ Bot is running!');
}

main().catch(console.error);
