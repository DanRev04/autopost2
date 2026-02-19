import cron from 'node-cron';
import { getSubscribedUsers } from './database.js';
import { fetchEvents, formatEventsMessage } from './events.js';
import { CITIES } from './config.js';
import { escapeHTML } from './textUtils.js';

/**
 * Send weekly event notifications to all subscribers
 */
async function sendWeeklyNotifications(bot) {
    console.log('📬 Sending weekly notifications...');

    const subscribers = getSubscribedUsers();
    console.log(`Found ${subscribers.length} subscribers`);

    for (const user of subscribers) {
        try {
            const city = CITIES[user.city_slug] || CITIES.msk;
            const events = await fetchEvents(city.slug);
            const message = formatEventsMessage(events, city.slug);

            await bot.telegram.sendMessage(user.telegram_id, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });

            console.log(`✅ Sent to user ${user.telegram_id}`);

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.error(`❌ Failed to send to user ${user.telegram_id}:`, error.message);
        }
    }

    console.log('📬 Weekly notifications complete');
}

/**
 * Start the scheduler
 */
export function startScheduler(bot) {
    const schedule = process.env.CRON_SCHEDULE || '0 10 * * 5'; // Default: Friday 10:00

    cron.schedule(schedule, () => {
        sendWeeklyNotifications(bot);
    });

    console.log(`⏰ Scheduler started with schedule: ${schedule}`);
}

export { sendWeeklyNotifications };
