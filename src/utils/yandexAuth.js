import crypto from 'crypto';

/**
 * Generates the Yandex Tickets API authentication identifier.
 * Format: login : sha1( md5(password) timestamp ) : timestamp
 * 
 * @param {string} login - API login
 * @param {string} password - API password
 * @param {number|string} [timestamp] - Unix Timestamp (seconds). If not provided, current time is used.
 * @returns {string} The formatted authentication string.
 */
export function generateAuthString(login, password, timestamp) {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    
    // 1. MD5 hash of password
    const md5Hash = crypto.createHash('md5').update(password).digest('hex');
    
    // 2. SHA-1 hash of (MD5 hash + timestamp)
    const sha1Hash = crypto.createHash('sha1').update(md5Hash + ts).digest('hex');
    
    // 3. Combine into final string
    return `${login}:${sha1Hash}:${ts}`;
}
