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

            // Attach photo to newsletter
            const IMAGE_URL = 'https://files.catbox.moe/kh2qko.jpg';
            
            try {
                // First attempt: Try sending as native photo with the FULL message.
                // Note: Standard Telegram limit is 1024, but platforms like "Max" may support more.
                await bot.telegram.sendPhoto(user.telegram_id, IMAGE_URL, {
                    caption: message,
                    parse_mode: 'HTML'
                });
            } catch (error) {
                console.error(`❌ Native sendPhoto (full) failed for ${user.telegram_id}:`, error.message);
                
                // Fallback: Message with clean link preview (no visible link in text)
                const msgWithPhoto = `<a href="${IMAGE_URL}">&#8203;</a>${message}`;
                await bot.telegram.sendMessage(user.telegram_id, msgWithPhoto, {
                    parse_mode: 'HTML',
                    link_preview_options: {
                        is_disabled: false,
                        show_above_text: true,
                        url: IMAGE_URL
                    }
                });
            }

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
