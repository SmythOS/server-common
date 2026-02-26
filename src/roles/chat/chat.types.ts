import { ILLMContextStore } from '@smythos/sdk/core';

export interface IChatResponse {
    hashId?: string;
    content?: string;
    title?: string;
    debug?: string;
    function?: string;
    parameters?: any[];
    callParams?: string;
    function_call?: any;
    isError?: boolean;
    errorType?: string;
    /** HTTP-equivalent status code for the error (e.g. 400, 429, 500). Present when isError is true. */
    errorStatus?: number;
    /** Machine-readable error code (e.g. 'rate_limit_exceeded', 'invalid_request'). Present when isError is true. */
    errorCode?: string;
    debugOn?: boolean;
    status_message?: string;
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
