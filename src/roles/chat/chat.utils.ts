import crypto from 'crypto';

export function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generates a short, unique hash identifier for tool calls using FNV1a algorithm
 * @param str - The input string to generate hash from (usually tool ID)
 * @returns A Base36 uppercase hash string (e.g., "A1B2C3D4")
 * @example
 * ```ts
 * const toolHash = generateToolHash("searchDatabase");
 * console.log(toolHash); // "A1B2C3D4"
 * ```
 */
export function generateToolHash (str: string) {
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193); // FNV prime
    }
    return (hash >>> 0).toString(36).toUpperCase(); // Convert to Base36
};

export function getCurrentFormattedDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}

export type ChatConversationsEnv = 'test' | 'prod';
export const CHAT_PREFIXES: Record<ChatConversationsEnv, string> = {
    test: 'chat-test-',
    prod: 'chat-',
};

export function buildConversationId(uid?: string, isTestConv = false) {
    const prefix = isTestConv ? CHAT_PREFIXES.test : CHAT_PREFIXES.prod;
    const convId = uid ?? `${prefix}${getCurrentFormattedDate()}-${crypto.randomBytes(8).toString('hex')}`;
    return `${prefix}${getCurrentFormattedDate()}-${convId}`;
};