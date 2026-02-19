import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const dbPath = join(dataDir, 'bot.db');

let db = null;

/**
 * Save database to file
 */
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        writeFileSync(dbPath, buffer);
    }
}

/**
 * Initialize database
 */
export async function initDatabase() {
    // Ensure data directory exists
    mkdirSync(dataDir, { recursive: true });

    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (existsSync(dbPath)) {
        const fileBuffer = readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            telegram_id INTEGER PRIMARY KEY,
            username TEXT,
            city_slug TEXT DEFAULT 'msk',
            subscribed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    saveDatabase();
    console.log('✅ Database initialized');
}

/**
 * Get or create user
 */
export function getUser(telegramId, username = null) {
    let result = db.exec('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);

    if (result.length === 0 || result[0].values.length === 0) {
        db.run('INSERT INTO users (telegram_id, username) VALUES (?, ?)', [telegramId, username]);
        saveDatabase();
        result = db.exec('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    }

    if (result.length > 0 && result[0].values.length > 0) {
        const columns = result[0].columns;
        const values = result[0].values[0];
        const user = {};
        columns.forEach((col, i) => {
            user[col] = values[i];
        });
        return user;
    }

    return null;
}

/**
 * Update user's city
 */
export function setUserCity(telegramId, citySlug) {
    db.run('UPDATE users SET city_slug = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?',
        [citySlug, telegramId]);
    saveDatabase();
}

/**
 * Subscribe user to notifications
 */
export function subscribeUser(telegramId) {
    db.run('UPDATE users SET subscribed = 1, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?',
        [telegramId]);
    saveDatabase();
}

/**
 * Unsubscribe user from notifications
 */
export function unsubscribeUser(telegramId) {
    db.run('UPDATE users SET subscribed = 0, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?',
        [telegramId]);
    saveDatabase();
}

/**
 * Get all subscribed users
 */
export function getSubscribedUsers() {
    const result = db.exec('SELECT * FROM users WHERE subscribed = 1');

    if (result.length === 0) return [];

    const columns = result[0].columns;
    return result[0].values.map(values => {
        const user = {};
        columns.forEach((col, i) => {
            user[col] = values[i];
        });
        return user;
    });
}

export default db;
