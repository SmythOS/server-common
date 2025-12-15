import { Readable } from 'stream';
import { OpenAI } from 'openai';
import APIError from '@/APIError.class';
interface ChatCompletionParams {
    apiKey: string;
    modelId: string;
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
    options?: {
        include_status?: boolean;
    };
}
declare class OpenAIChatService {
    chatCompletion({ apiKey, modelId, params, options, }: ChatCompletionParams): Promise<OpenAI.Chat.Completions.ChatCompletion | Readable | APIError>;
    private firstTime;
    private randomlyEmitStatus;
    private fakeStream;
}
export declare const chatService: OpenAIChatService;
export {};
