import express from 'express';
import { AccessCandidate, BinaryInput, ILLMContextStore } from '@smythos/sdk/core';

import AgentLoader from '@/middlewares/AgentLoader.mw';
import { BaseRole } from '@/roles/Base.role';
import { CHATBOT_EMBODIMENT_TYPE } from '@/constants';

import { readAgentOAuthConfig } from './helpers/agent.helper';
import { ChatService } from './Chat.service';
import { IChatResponse } from './chat.types';
import { buildConversationId } from './chat.utils';

// Reuse the same TTL that was used in chatbot upload
const MAX_TTL_CHAT_FILE_UPLOAD = 60 * 60 * 24 * 1; // 1 day


export class ChatRole extends BaseRole {
    /**
     * Creates a new ChatRole instance.
     * @param middlewares - Custom middlewares to apply to the role on top of the default middlewares.
     * @param options - Configuration options for the role.
     * @param options.beforeMount - Optional callback executed before mounting routes, useful for adding custom middleware or routes.
     */
    constructor(
        middlewares: express.RequestHandler[] = [],
        options: {
            serverOrigin: string | ((req: express.Request) => string);
            llmContextStore?: ({ conversationID, agentId }: { conversationID: string; agentId: string }) => ILLMContextStore;
            authToken?: (req: express.Request) => string;
            env: {
                UI_SERVER: string;
                AGENT_DOMAIN: string;
                AGENT_DOMAIN_PORT: number;
            };
            beforeMount?: (router: express.Router) => Promise<void>;
        },
    ) {
        super(middlewares, options);
    }

    /**
     * Mounts the chat endpoints on the provided router.
     *
     * Creates routes for the chat embodiment interface.
     *
     * @param router - The Express router to mount the endpoints on.
     */
    public async mount(router: express.Router) {
        const middlewares = [AgentLoader, ...this.middlewares];

        // It's important to add the middlewares before beforeMount, so that
        // any custom routes registered in beforeMount will also be protected
        // by the base middlewares (AgentLoader, etc.)
        router.use(middlewares);

        // The before-route callback lets consumer projects customize routing.
        // It can be used to add route-specific middleware, register custom routes,
        // or apply any setup needed before the routes are initialized when using server-common.
        if (typeof this.options?.beforeMount === 'function') {
            await this.options.beforeMount(router);
        }

        router.post(
            '/stream',
            async (req, res) => {
                let streamStarted = false;
                const agentData = req._agentData;
                const agentVersion = agentData?.version;
                const isDebugSession = agentData?.debugSessionEnabled;
                const requestId = Math.random().toString(36).slice(2, 10).toUpperCase();
                const startedAt = Date.now();
        
                const verifiedKey = this.resolve(this.options.authToken, req);
        
                const abortController = new AbortController();
        
                try {
                    let { message } = req.body;
                    const { attachments = [], enableMetaMessages = false } = req.body;
        
                    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
                    if (hasAttachments) {
                        message = [message, '###', 'Attachments:', ...attachments.map((a) => `- ${a?.url}`)].join('\n');
                    }

                    const serverOrigin = this.resolve(this.options.serverOrigin, req);

                    //TODO : cache the chatbot instance and reuse it if the request is the same
                    const conversationID = req.header('x-conversation-id') || req.sessionID;
                    const agentId = agentData?.id;
                    const llmContextStore = this.resolve(this.options.llmContextStore, { conversationID, agentId });

                    const chatbot = new ChatService(req, { enableMetaMessages, serverOrigin, llmContextStore });
                    req._chatbot = chatbot;
        
                    await chatbot.init();

                    chatbot.conversationID = (req.header('x-conversation-id') as string) || req.sessionID;
                    const monitorId = req.header('x-monitor-id');
                    const authToken = req.headers['x-auth-token'];
        
                    const headers: Record<string, any> = {
                        'X-AGENT-ID': agentId,
                        'X-AGENT-VERSION': agentVersion,
                        //'X-AGENT-HAS-ATTACHMENTS': hasAttachments,
                        'x-conversation-id': chatbot.conversationID,
                    };
        
                    if (isDebugSession) headers['X-DEBUG'] = true;
                    if (monitorId) headers['X-MONITOR-ID'] = monitorId;
                    if (verifiedKey) headers.Authorization = `Bearer ${verifiedKey}`;
                    if (authToken) headers['x-auth-token'] = authToken;
        
                    req.on('close', () => {
                        console.warn('[ChatRouter:stream:aborted]', {
                            requestId,
                            durationMs: Date.now() - startedAt,
                            streamStarted,
                        });
                        abortController.abort();
                    });
        
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');
        
                    await chatbot.getChatStreaming({
                        message,
                        callback: (data: IChatResponse) => {
                            try {
                                res.write(JSON.stringify(data));
                            } catch (writeErr) {
                                console.error('[ChatRouter:stream:write-error]', {
                                    requestId,
                                    errorMessage: writeErr?.message,
                                });
                            }
                            streamStarted = true;
                        },
                        headers,
                        abortSignal: abortController.signal,
                    });
        
                    res.end();
                } catch (error) {
                    console.error('[ChatRouter:stream:error]', {
                        requestId,
                        durationMs: Date.now() - startedAt,
                        errorMessage: error?.message,
                        errorCode: error?.code,
                        errorStack: error?.stack,
                        streamStarted,
                    });
                    if (!streamStarted) {
                        res.status(500).send({
                            content: error?.message || 'An error occurred. Please try again later.',
                            isError: true,
                            errorType: 'api_error',
                        });
                    } else {
                        // Stream has started - error should have been sent via callback already
                        // Only send connection error if it's a network/connection issue
                        if (error?.code === 'ECONNRESET' || error?.code === 'ENOTFOUND' || error?.code === 'ETIMEDOUT') {
                            res.write(
                                JSON.stringify({
                                    content: "I'm not able to contact the server. Please try again.",
                                    isError: true,
                                    errorType: 'connection_error',
                                })
                            );
                        }
                        res.end();
                    }
                }
            }
        );

        router.post(
            '/upload',
            async (req, res) => {
                try {
                    if (!req.files || req.files.length === 0) {
                        return res.status(400).json({ error: 'No files uploaded' });
                    }
        
                    const agentData = req._agentData;
                    const uploadedFiles = [];
        
                    for (const file of req.files) {
                        try {
                            const candidate = AccessCandidate.agent(agentData?.id);
                            const binaryInput = BinaryInput.from(file.buffer, null, file.mimetype, candidate);
                            await binaryInput.ready();
                            // getJsonData implicitly uploads the file to SmythFS
                            const fileData = await binaryInput.getJsonData(candidate, MAX_TTL_CHAT_FILE_UPLOAD);
        
                            uploadedFiles.push({
                                size: file.size,
                                url: fileData.url,
                                mimetype: file.mimetype,
                                originalName: file.originalname,
                            });
                        } catch (error) {
                            console.error('Error uploading file:', file.originalname, error);
                        }
                    }
        
                    res.json({ success: true, files: uploadedFiles });
                } catch (error) {
                    console.error('Error handling file upload:', error);
                    res.status(500).json({ success: false, error: 'Failed to process file upload' });
                }
            }
        );

        router.get(
            '/params',
            async (req, res) => {
                const agentData = req._agentData;
                const agentSettings = req._agentSettings;
                const agentAuthData = req._agentAuthData;
        
                const promises = [agentSettings?.ready(), agentSettings?.embodiments?.ready()];

                await Promise.all(promises);
        
                let authInfo = null;
        
                if (agentData?.auth && agentData?.auth?.method !== 'none') {
                    authInfo = await readAgentOAuthConfig(agentData?.id);
                }
        
                const sessionAuthorized = req._isSessionAuthorized;
        
                const isAuthRequired = () => {
                    const isAuthDisabled = agentData?.debugSessionEnabled && agentData.usingTestDomain;
                    return !isAuthDisabled && !!agentAuthData?.method && !sessionAuthorized;
                };
        
                // Determine if the chatbot is enabled
                const isChatbotEnabled = agentData.usingTestDomain ? true : agentSettings?.get(CHATBOT_EMBODIMENT_TYPE.toLowerCase()) === 'true';
        
                // Retrieve chatbot properties
                const chatbotProperties = agentSettings?.embodiments?.get(CHATBOT_EMBODIMENT_TYPE) || {};
        
                // If chatbot properties exist, append the 'chatbotEnabled' flag
                if (chatbotProperties) {
                    const chatbotName = agentSettings?.embodiments.get(CHATBOT_EMBODIMENT_TYPE, 'name') || agentData.name;
        
                    const hostname = req.hostname || '';
                    const isLocalAgent = hostname.includes('localagent');
        
                    const AGENT_URL = req.agentUrl;
        
                    const callbackPath = '/emb/auth/callback';
                    const redirectUri = `${AGENT_URL}${callbackPath}`;
        
                    const authorizationUrl = `${AGENT_URL}/oauth/authorize?response_type=code&client_id=${authInfo?.provider?.clientID}&redirect_uri=${redirectUri}`;
        
                    delete chatbotProperties.chatGptModel;
        
                    Object.assign(chatbotProperties, {
                        name: chatbotName,
                        domain: agentData?.domain,
                        port: isLocalAgent ? this.options.env.AGENT_DOMAIN_PORT : undefined,
                        chatbotEnabled: isChatbotEnabled,
                        authRequired: isAuthRequired(),
                        auth: {
                            method: authInfo?.method,
                            redirectUri: redirectUri,
                            authorizationUrl: authorizationUrl,
                            clientID: authInfo?.provider?.clientID,
                            redirectInternalEndpoint: callbackPath,
                        },
                    });
        
                    //* Note: chatbot conversations are not created in db table, it is just a uid created on the fly
                    //* On the other hand, Agent Chat conversations are created in db table and can be retrieved from db
                    const isTestDomain = agentData.usingTestDomain;
                    const conversationId = buildConversationId(undefined, isTestDomain);
        
                    chatbotProperties.headers = { 'x-conversation-id': conversationId };
        
                    res.send(chatbotProperties);
                } else {
                    // Send only the 'chatbotEnabled' flag if no properties are found
                    res.send({ chatbotEnabled: isChatbotEnabled });
                }
            }
        );

        router.get('/', async (req, res) => {
            const agentData = req._agentData;
            const agentSettings = req._agentSettings;
            const debugSessionEnabled = agentData.debugSessionEnabled;
            const isTestDomain = agentData.usingTestDomain;
        
            // wait for agent embodiments to be ready
            await agentSettings?.embodiments?.ready();
        
            const name = agentSettings?.embodiments?.get(CHATBOT_EMBODIMENT_TYPE, 'name') || agentData.name;
            let introMessage = agentSettings?.embodiments?.get(CHATBOT_EMBODIMENT_TYPE, 'introMessage') || '';
            //escape string for javascript
            introMessage = introMessage.replace(/'/g, "\\'").replace(/"/g, '\\"');
        
            const logo = agentSettings?.embodiments?.get(CHATBOT_EMBODIMENT_TYPE, 'icon') || 'https://proxy-02.api.smyth.ai/static/img/icon.svg';
            const colors = agentSettings?.embodiments?.get(CHATBOT_EMBODIMENT_TYPE, 'colors');
            //force meta messages to be enabled for test domains
            const enableMetaMessages = agentSettings?.embodiments?.get(CHATBOT_EMBODIMENT_TYPE, 'enableMetaMessages') || isTestDomain;
        
            const { allowAttachments = true } = req.query;
        
            let debugScript = '';
            if (isTestDomain || debugSessionEnabled) {
                debugScript = `
        <script src="/static/embodiment/rpc-debug-utils.js"></script>
        <script src="/static/embodiment/chatBot/chatbot-debug.js"></script>
        <script src="/static/embodiment/oauth-debug.js"></script>
        <script>
        initChatbotDebug('${this.options.env.UI_SERVER}', '${agentData.id}');
        initOAuthDebug('${this.options.env.UI_SERVER}');
        </script>
        `;
            }
            res.send(`
        <!doctype html>
        <html lang="en" style="height: 100%;margin: 0;padding: 0;">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <link rel="shortcut icon" href="${logo}" type="image/x-icon">
            <title>${name}</title>
        </head>
        <body style="height: 100%;margin: 0;padding: 0;">
            <div id="smyth-chatbot-page" style="height: 100%;"></div>
            <script src="/static/embodiment/chatBot/chatbot-v2.js"></script>
            <script>
                ChatBot.init({
                    containerId: 'smyth-chatbot-page',
                    logo: '${logo}',
                    isChatOnly: true,
                    introMessage: '${introMessage}',
                    allowAttachments: ${allowAttachments},
                    enableMetaMessages: ${enableMetaMessages},
                    //domain:'${agentData.id}.${this.options.env.AGENT_DOMAIN}',
                    colors: ${JSON.stringify(colors, null, 2)},
                });
            </script>
            ${debugScript}
        </body>
        </html>`);
        });
    }
}
