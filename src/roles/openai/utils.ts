import { OpenAI } from 'openai';

/**
 * Extracts a Bearer token from the Authorization header
 * @param authHeader - The Authorization header value
 * @returns The extracted token or null if the token is invalid
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader) {
        return null;
    }

    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.slice(7).trim();

    if (!token?.length) {
        return null;
    }

    return token;
}

export function createOpenAIError(statusCode: number, error: any) {
    return new OpenAI.APIError(
        statusCode,
        {
            code: error?.errKey || error?.code,
            message: error?.message,
            type: error?.name,
        },
        error?.message,
        null,
    );
}
