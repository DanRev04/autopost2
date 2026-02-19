/**
 * Utility functions for text processing
 */

/**
 * Robustly decodes HTML entities (names, decimal, hex)
 */
function decodeEntities(text) {
    if (!text) return '';
    return text
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&hellip;/g, '…')
        .replace(/&#8230;/g, '…')
        .replace(/&#x2026;/g, '…')
        // General decimal/hex entities
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Clean text and ensure it consists ONLY of complete sentences.
 * Removes all forms of ellipses and trailing incomplete fragments.
 * 
 * @param {string} text - The raw text
 * @param {number} maxLength - Maximum length for the text
 * @returns {string} - Cleaned text with only complete sentences, or empty string
 */
export function cleanDescription(text, maxLength = 250) {
    if (!text) return '';

    // 1. Strip HTML tags and decode entities
    let cleaned = decodeEntities(text.replace(/<[^>]+>/g, ''));

    // 2. Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (!cleaned) return '';

    // 3. Brutally remove all ellipsis patterns before sentence detection
    // This includes spaced dots (. . .), unicode (…), and multiples (..)
    cleaned = cleaned
        .replace(/…/g, ' ')
        .replace(/\.\s*(?:\.\s*)+/g, ' ')
        .replace(/\.{2,}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return '';

    // 4. Truncate to maxLength at word boundary
    if (cleaned.length > maxLength) {
        cleaned = cleaned.substring(0, maxLength);
        // Cut at last space to avoid breaking words
        const lastSpace = cleaned.lastIndexOf(' ');
        if (lastSpace > maxLength * 0.5) {
            cleaned = cleaned.substring(0, lastSpace);
        }
    }

    // 5. Detect genuine sentence end (. ! ?)
    // We look for the absolute last occurrence in the cleaned string
    const lastSentenceEnd = Math.max(
        cleaned.lastIndexOf('.'),
        cleaned.lastIndexOf('!'),
        cleaned.lastIndexOf('?')
    );

    // 6. Return only the valid part if it's long enough
    if (lastSentenceEnd > 3) {
        return cleaned.substring(0, lastSentenceEnd + 1).trim();
    }

    // 7. If no sentences found, it's either a fragment or too short
    return '';
}

/**
 * Specifically clean titles and short strings.
 * Removes ellipses and fragments without being as strict as descriptions.
 */
export function cleanTitle(text) {
    if (!text) return '';

    let cleaned = decodeEntities(text.replace(/<[^>]+>/g, ''));

    return cleaned
        .replace(/…/g, '')
        .replace(/\.\s*(?:\.\s*)+/g, '')
        .replace(/\.{2,}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Escape HTML special characters for Telegram HTML mode
 */
export function escapeHTML(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
