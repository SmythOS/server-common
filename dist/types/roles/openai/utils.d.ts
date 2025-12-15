/**
 * Extracts a Bearer token from the Authorization header
 * @param authHeader - The Authorization header value
 * @returns The extracted token or null if the token is invalid
 */
export declare function extractBearerToken(authHeader: string | undefined): string | null;
export declare function createOpenAIError(statusCode: number, error: any): import("openai").APIError<number, any, {
    code: any;
    message: any;
    type: any;
}>;
