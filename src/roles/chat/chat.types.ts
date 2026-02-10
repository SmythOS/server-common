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
