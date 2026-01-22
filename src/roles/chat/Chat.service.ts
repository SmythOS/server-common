import { Request } from 'express';
import { Agent, Chat, TLLMEvent } from '@smythos/sdk';
import {AgentLogger, AgentSettings, ILLMContextStore } from '@smythos/sdk/core';

import { DEFAULT_AGENT_MODEL, CHATBOT_EMBODIMENT_TYPE } from '@/constants';
import { injectInternalTools } from './helpers/conversation.helper';
import { delay, generateToolHash } from './chat.utils';
import { IChatServiceOptions, IChatResponse, IChatStreaming } from './chat.types';

export class ChatService {
    public sessionID;
    public conversationID;
    public agentId;
    public domain;
    public embodimentSettings;

    private agent: Agent; // ✅ Pure SDK Agent
    private agentSettings: AgentSettings;
    private agentData: any;
    private agentVersion: string;
    //private sreAgent: SreAgent; // Keep SRE agent reference for AgentLogger
    private model = DEFAULT_AGENT_MODEL;
    private modelInfo: any;
    private systemMessage = '';
    private maxOutputTokens = 4096;
    private function_call_order = 0;
    private contextWindow = 1024 * 128;
    private logId = '';
    private client_ip = '';
    private toolCallId = '';
    private passThroughNotifications = {};
    /**
     * Enable meta messages (tool calls, tasks, thinking) sent to client.
     * Set via 'x-enable-meta-messages' header.
     * @future Support array for granular control: ['toolCalls', 'tasks', 'thinking']
     */
    private enableMetaMessages = false;
    private conversationTurnId = '';
    private serverOrigin = '';
    private llmContextStore: ILLMContextStore | undefined;

    constructor(req: Request | any, options: IChatServiceOptions) {
        this.agentSettings = req._agentSettings;
        this.agentData = req._agentData;
        this.agentVersion = req._agentVersion;
        this.agentId = this.agentData?.id; //from AgentLoader middleware
        this.sessionID = req.sessionID;
        this.conversationID = req.header('x-conversation-id') || req.sessionID;

        this.domain = this.agentData?.domain; //req.hostname;
        //this.sreAgent = req._agent; // Keep SRE agent for AgentLogger
        this.client_ip = req.header('x-forwarded-for') || req.socket.remoteAddress;
        this.enableMetaMessages = options.enableMetaMessages ?? false;
        this.serverOrigin = options.serverOrigin || '';
        this.llmContextStore = options.llmContextStore || undefined;

        // Check if model override is provided in header
        const modelOverride = req.header('x-model-id');
        if (modelOverride) this.model = modelOverride;
    }

    public async init() {
        // Get model from SRE agent settings
        await this.agentSettings?.ready();
        await this.agentSettings?.embodiments?.ready();

        // Only use settings model if not already overridden from header
        if (this.model === DEFAULT_AGENT_MODEL) {
            this.model =
                this.agentSettings?.get('chatGptModel') ||
                this.agentSettings?.embodiments?.get(CHATBOT_EMBODIMENT_TYPE, 'chatGptModel') ||
                this.model;
        }

        // Import as SDK Agent with proper model
        //this.sreAgent.data.components?.unshift(...defaultFileParsingAgent.components);
        //this.sreAgent.data.connections?.unshift(...defaultFileParsingAgent.connections);

        this.agent = Agent.import(this.agentData, { model: this.model });

        // Wait for agent to be ready - SDK handles all component conversion automatically
        await this.agent.ready;
    }

    /**
     * We use this function to serialize the chatbot object to save it in session
     * @returns {Object} serialized object
     */
    public serialize() {
        return {
            agentId: this.agentId,
            domain: this.domain,
            model: this.model,
            modelInfo: this.modelInfo,
            agentVersion: this.agentVersion,
            systemMessage: this.systemMessage,
            contextWindow: this.contextWindow,
            maxOutputTokens: this.maxOutputTokens,
            embodimentSettings: this.embodimentSettings,
            function_call_order: this.function_call_order,
        };
    }

    /**
     * We use this function to deserialize the chatbot object from session
     * @param data {Object} serialized object
     */
    public deserialize(data) {
        this.agentId = data.agentId;
        this.domain = data.domain;
        this.model = data.model;
        this.modelInfo = data.modelInfo;
        this.systemMessage = data.systemMessage;
        this.contextWindow = data.contextWindow;
        this.maxOutputTokens = data.maxOutputTokens;
        this.embodimentSettings = data.embodimentSettings;
        this.function_call_order = data.function_call_order;
    }

    /**
     * Helper method to send error messages as normal content with error flags
     * @param error - The error object or message
     * @param errorType - Type of error for categorization
     * @param callback - Callback function to send response
     * @param conversationTurnId - Optional turn ID for grouping (backward compatible)
     */
    private sendErrorMessage(error: any, errorType: string, callback: (response: IChatResponse) => void, conversationTurnId?: string) {
        const apiKeyError = error?.error?.error?.message;
        const googleApiKeyError = error?.errorDetails && error?.errorDetails[1]?.message;
        const errorMessage =
            apiKeyError || googleApiKeyError
                ? `401 Incorrect API key provided: ${apiKeyError || googleApiKeyError}`
                : error?.message || error?.code || error || 'An error occurred. Please try again later.';

        callback({ isError: true, errorType: errorType, content: errorMessage, conversationTurnId });
    }

    /**
     * Helper method to clean up chat session and resolve the promise
     * This method resets the logId and resolves the promise to complete the chat streaming
     * @param resolve - The resolve function from the Promise
     */
    private cleanupAndResolve(resolve: () => void) {
        this.logId = '';
        this.conversationTurnId = '';
        resolve();
    }

    /**
     * Generates a unique conversation turn ID for grouping related messages
     * All AI responses (thinking, function calls, content) for a single user message share the same turnId
     *
     * Format: turn_{timestamp}_{random}
     * - timestamp: Current time in milliseconds (sortable, debuggable)
     * - random: 9 random characters (ensures uniqueness for concurrent requests)
     *
     * @returns Unique turn identifier
     * @example "turn_1735123456789_abc123xyz"
     */
    private generateConversationTurnId(): string {
        const timestamp = Date.now();
        const randomPart = Math.random().toString(36).substring(2, 11); // 9 chars
        return `turn_${timestamp}_${randomPart}`;
    }

    public async getChatStreaming({ message, callback, headers, abortSignal }: IChatStreaming): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.function_call_order++;
            let errorSent = false; // Flag to prevent duplicate error messages

            // Generate unique conversation turn ID for this user message
            // All AI responses (thinking, function calls, content) will share this turnId
            this.conversationTurnId = this.generateConversationTurnId();
            this.logId = AgentLogger.log(this.agentData, null, {
                sourceId: 'chat',
                componentId: 'CHATBOT',
                model: this.model,
                domain: this.domain,
                input: message,
                inputTimestamp: new Date().toISOString(),
                sessionID: this.conversationID,
                conversationTurnId: this.conversationTurnId, // Include in logs for debugging
            });
            this.toolCallId = Math.round(Math.random() * Math.pow(10, 6))
                .toString(36)
                .toUpperCase();

            // Wrap async logic in IIFE to avoid async Promise executor
            (async () => {
                try {
                    // ✅ Pure SDK approach - no OpenAPI spec needed, SDK handles everything
                    const baseUrl = this.serverOrigin;
                    const chat: Chat = this.agent.chat({
                        id: this.conversationID,
                        baseUrl,
                        persist: this.llmContextStore || undefined,
                        maxContextSize: this.contextWindow,
                        maxOutputTokens: this.maxOutputTokens,
                    });
                    injectInternalTools(this.agent, chat._conversation);

                    const concurrentCalls = this.agentData?.debugSessionEnabled ? 1 : 4;
                    const isStickyDebug = this.agentData?.debugSessionEnabled || headers['X-MONITOR-ID'];
                    const dbgHeaders = isStickyDebug ? { 'x-hash-id': this.client_ip } : {};
                    const _headers = { 'x-caller-session-id': this.conversationID, ...headers, ...dbgHeaders };

                    const chatStream = await chat.prompt(message, { headers: _headers, concurrentCalls }).stream();

                    // ✅ Clean event handling - all events include conversationTurnId
                    chatStream.on(TLLMEvent.Content, (content) => {
                        if (content?.indexOf('}{') >= 0) {
                            content = content.replace(/}{/g, '} {');
                        }
                        callback({ content, conversationTurnId: this.conversationTurnId });
                    });

                    chatStream.on(TLLMEvent.ToolInfo, (toolInfo) => this.toolsInfoHandler(toolInfo, callback));

                    chatStream.on(TLLMEvent.ToolCall, (toolInfo) => this.beforeToolCallHandler(toolInfo, callback));

                    chatStream.on(TLLMEvent.ToolResult, (toolInfo) => this.afterToolCallHandler(toolInfo, callback));

                    chatStream.on(TLLMEvent.End, () => this.cleanupAndResolve(resolve));

                    chatStream.on(TLLMEvent.Error, (error) => {
                        if (!errorSent) {
                            errorSent = true;
                            this.sendErrorMessage(error, 'stream_error', callback, this.conversationTurnId);
                        }
                        this.cleanupAndResolve(resolve); // Don't reject - error already sent via callback
                    });

                    if (abortSignal) {
                        abortSignal.addEventListener('abort', () => this.cleanupAndResolve(resolve));
                    }
                } catch (error) {
                    if (this.logId) {
                        AgentLogger.log(this.agentData, this.logId, {
                            error: typeof error === 'object' ? JSON.stringify(error) : error,
                        });
                    }

                    if (!errorSent) {
                        errorSent = true;
                        this.sendErrorMessage(error, 'system_error', callback, this.conversationTurnId);
                    }
                    this.cleanupAndResolve(resolve); // Don't reject - error already sent via callback
                }
            })();
        });
    }

    private async toolsInfoHandler(toolsInfo, callback: (response: IChatResponse) => void) {
        if (this.agentData?.usingTestDomain || this.enableMetaMessages) {
            for (const tool of toolsInfo) {
                // Check if the tool is an agent tool
                const isAgentTool = Object.values(this.agentData?.components || {}).find((component: any) => component?.data?.endpoint === tool.name);

                if (isAgentTool) {
                    // Find the component that matches this tool name to get status_message
                    const matchingComponent = Object.values(this.agentData?.components || {}).find(
                        (component: any) => component?.name === 'APIEndpoint' && component?.data?.endpoint === tool.name
                    );

                    const statusMessage = (matchingComponent as any)?.data?.status_message || '';
                    const parameters = tool?.arguments && typeof tool?.arguments === 'object' ? JSON.stringify(tool?.arguments) : tool?.arguments;

                    // Generate unique hash by combining conversationTurnId with tool.id to ensure uniqueness across turns
                    const toolHash = tool.id ? generateToolHash(`${this.conversationTurnId}_${tool.id}`) : this.toolCallId;

                    const dbgJson = {
                        hashId: toolHash,
                        title: tool.name,
                        status_message: statusMessage,
                        debug: '',
                        parameters,
                        debugOn: true, // Mark debug as started
                        conversationTurnId: this.conversationTurnId,
                    };

                    if (this.agentData?.debugSessionEnabled) {
                        //attach to UI debugger
                        dbgJson['function'] = 'updateStatus';
                        dbgJson['status_message'] = statusMessage;
                        dbgJson['callParams'] = parameters;
                        dbgJson['parameters'] = ['Debugger: Attaching To Agent ...'];
                    }

                    callback(dbgJson);
                    await delay(50);
                    callback({ function_call: { name: tool.name, arguments: tool.arguments }, conversationTurnId: this.conversationTurnId });
                }
            }
        }
    }

    private async beforeToolCallHandler({ tool, _llmRequest }, callback: (response: IChatResponse) => void) {
        const args = tool.arguments;
        const llmResponse = _llmRequest;
        if (this.logId) AgentLogger.log(this.agentData, this.logId, { output: llmResponse, outputTimestamp: new Date().toISOString() });

        // Check if the tool is an agent tool
        const isAgentTool = Object.values(this.agentData?.components || {}).find((component: any) => component?.data?.endpoint === tool.name);

        if ((this.agentData?.usingTestDomain || this.enableMetaMessages) && this.agentData?.debugSessionEnabled && isAgentTool) {
            // Generate unique hash by combining conversationTurnId with tool.id to ensure uniqueness across turns
            const toolHash = tool.id ? generateToolHash(`${this.conversationTurnId}_${tool.id}`) : this.toolCallId;

            const dbgJson = {
                debugOn: true,
                hashId: toolHash,
                title: tool.name,
                debug: '',
                callParams: args && typeof args === 'object' ? JSON.stringify(args) : args,
                conversationTurnId: this.conversationTurnId,
            };
            dbgJson['function'] = 'callParentFunction';
            dbgJson['parameters'] = ['debugLastAction', [], 200];
            callback(dbgJson);
            await delay(3000); //give some time to the UI debugger to attach - FIXME : find a better way to do this
        }
    }

    private async afterToolCallHandler({ tool, result }, callback: (response: IChatResponse) => void) {
        const toolResponse = typeof result === 'object' ? JSON.stringify(result) : result;
        // Generate unique hash by combining conversationTurnId with tool.id to ensure uniqueness across turns
        const toolHash = tool.id ? generateToolHash(`${this.conversationTurnId}_${tool.id}`) : this.toolCallId;
        if (this.agentData?.usingTestDomain || this.enableMetaMessages) {
            //workaround to avoid broken debug message in the frontend
            //replace all "}{" with "} {";
            const _toolResponse = toolResponse.replace(/}\{/g, '}_{');
            const chunkSize = 500;
            for (let i = 0, len = _toolResponse.length; i < len; i += chunkSize) {
                const chunk = _toolResponse.substr(i, chunkSize);

                if (!this.passThroughNotifications[this.toolCallId]) {
                    callback({ hashId: toolHash, title: tool.name, debug: chunk, conversationTurnId: this.conversationTurnId });
                }
            }

            // Send debugOn: false to indicate debug is complete
            if (!this.passThroughNotifications[this.toolCallId]) {
                callback({ hashId: toolHash, title: tool.name, debugOn: false, conversationTurnId: this.conversationTurnId });
            }
        }
    }
}

