import { ILLMContextStore } from '@smythos/sdk/core';

export interface IChatResponse {
    /**
     * Conversation Turn ID
     * Groups all AI responses (thinking, function calls, content) for a single user message
     * Format: turn_{timestamp}_{random}
     * @example "turn_1735123456789_abc123xyz"
     */
    conversationTurnId?: string;

    hashId?: string;

    title?: string;
    isError?: boolean;
    errorType?: string;
    content?: string;
    function_call?: {
        name: string;
        arguments: any;
    };
    /**
     * Debug function name for UI debugger
     * Used when debugSessionEnabled is true
     * @example "updateStatus" | "callParentFunction"
     */
    function?: string;
    debug?: string;
    debugOn?: boolean;
    status_message?: string;
    callParams?: string;
    parameters?: any[];
}

export interface IChatServiceOptions {
    /**
     * Enable meta messages (tool calls, tasks, thinking) sent to client.
     * @default false
     */
    enableMetaMessages?: boolean;
}

export interface IChatStreaming {
    message: string;
    callback: (response: IChatResponse) => void;
    headers: Record<string, string>;
    abortSignal?: AbortSignal;
    serverOrigin: string;
    llmContextStore?: ILLMContextStore;
}
