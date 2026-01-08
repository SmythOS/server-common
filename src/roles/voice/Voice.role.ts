import express from 'express';

import { AgentProcess, ConnectorService } from '@smythos/sdk/core';

import AgentLoader from '@/middlewares/AgentLoader.mw';
import { BaseRole } from '@/roles/Base.role';

import {
    createSpecInfoFromOpenAPI,
    createToolsFromOpenAPI,
    getAPIKeyFromVault,
    getErrorStyles,
    getErrorUI,
    getVoiceConfig,
    getVoiceEmbodimentInitScript,
} from './voice.helper';
import VoiceWebsocketConnectionService from './websocket.service';

const OPENAI_REALTIME_MODEL = 'gpt-realtime';
const VOICE = 'alloy';

export class VoiceRole extends BaseRole {
    /**
     * Creates a new VoiceRole instance.
     * @param middlewares - Custom middlewares to apply to the role on top of the default middlewares.
     * @param options - Configuration options for the role.
     * @param options.beforeMount - Optional callback function that runs before routes are mounted.
     */
    constructor(middlewares: express.RequestHandler[], options: { beforeMount?: (router: express.Router) => Promise<void> }) {
        super(middlewares, options);
    }

    /**
     * Mounts the voice embodiment endpoints on the provided router.
     *
     * Creates routes for:
     * 1. Voice embodiment UI (GET /)
     * 2. Ephemeral key generation (POST /ephemeral-key)
     * 3. WebSocket connection management (POST /ws-connect)
     *
     * @param router - The Express router to mount the endpoints on.
     * @throws Returns 500 error if API key retrieval or WebSocket connection fails.
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
        if (typeof this.options.beforeMount === 'function') {
            await this.options.beforeMount(router);
        }

        router.get('/', async (req, res) => {
            const agentData = req._agentData;
            // Set Permissions-Policy  header to allow storage and microphone access in iframe
            res.setHeader('Permissions-Policy', 'microphone=*, storage-access=*');

            // Construct the full URL including the path (e.g., /emb/voice or /voice)
            // Check for forwarded headers first (when behind proxy), then fallback to direct headers
            const host = req.get('x-forwarded-host') || req.get('host') || '';
            const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
            const hostname = host.split(':')[0] || '';

            // Check if this is a localagent domain (development/staging with custom port)
            const isLocalAgent = hostname.includes('localagent');

            // Construct the base URL with proper protocol and port
            const baseUrl = isLocalAgent ? `http://${host}` : `${protocol}://${hostname}`;

            // Construct the full path from baseUrl and path
            const fullPath = (req.baseUrl || '') + (req.path === '/' ? '' : req.path || '');
            const cleanPath = fullPath === '/' ? '/' : fullPath.replace(/\/$/, '');
            const urlToDisplay = `${baseUrl}${cleanPath}`;
            const isSecure = protocol === 'https' || req.secure;

            res.send(`
<!doctype html>
<html lang="en" style="height: 100%;margin: 0;padding: 0;">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link  rel="icon" type="image/png" href="/static/img/icon.svg" />
    <title>${agentData.name}</title>
    <style>${getErrorStyles()}</style>
</head>
<body style="height: 100%;margin: 0;padding: 0;">
    <div id="voice-embodiment-container" style="height: 100%;"></div>
    ${getErrorUI(urlToDisplay)}
    <script src="/static/embodiment/voice/voice-embodiment-minified.js"></script>
    <script>${getVoiceEmbodimentInitScript(isSecure, req.hostname, (req?.query?.type as string) || '')}</script>
</body>
</html>`);
        });

        router.post('/ephemeral-key', async (req, res) => {
            try {
                const agentData = req._agentData;
                const agentSettings = req._agentSettings;

                await agentSettings?.ready();

                // Check if the user has an OpenAI API key in the vault
                const userAPIKey = await getAPIKeyFromVault(agentData.id, 'openai');

                if (!userAPIKey) {
                    return res.status(404).json({
                        error: 'OpenAI API key not found in your vault. Please add your OpenAI API key to enable voice embodiment.',
                    });
                }

                const sessionConfig = JSON.stringify({
                    session: {
                        type: 'realtime',
                        model: OPENAI_REALTIME_MODEL,
                        audio: {
                            output: {
                                voice: VOICE,
                            },
                        },
                    },
                });

                const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${userAPIKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: sessionConfig,
                });

                if (!response.ok) {
                    const error = await response.text();
                    if (error.includes('invalid_api_key')) {
                        return res.status(response.status).json({ error: `Incorrect API key provided` });
                    }
                    return res.status(response.status).json({ error: `Failed to create ephemeral key: ${error}` });
                }

                const data = await response.json();

                res.json({
                    ephemeralKey: data?.value,
                    expiresAt: data?.expires_at,
                    model: OPENAI_REALTIME_MODEL,
                });
            } catch (error) {
                console.error('Error creating ephemeral key:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // WebSocket connection management endpoints
        router.post('/ws-connect', async (req, res) => {
            try {
                const domain = req.hostname;
                const agentData = req._agentData;
                const host = req.get('Host');
                const { callId, ephemeralKey } = req.query;

                if (!callId) {
                    return res.status(400).json({ error: 'callId query parameter is required' });
                }

                if (!ephemeralKey) {
                    return res.status(400).json({ error: 'ephemeralKey query parameter is required' });
                }

                const connection = await VoiceWebsocketConnectionService.createConnection(callId as string, ephemeralKey as string);

                if (!connection) {
                    return res.status(409).json({
                        error: 'Connection already exists for this callId',
                        callId,
                    });
                }

                // Set up event handlers
                connection.on('open', async () => {
                    const agentDataConnector = ConnectorService.getAgentDataConnector();
                    const openAPISpec = await agentDataConnector
                        .getOpenAPIJSON(agentData, domain, agentData.version, false)
                        .catch((error) => {
                            console.error(error);
                        });

                    if (openAPISpec) {
                        const tools = createToolsFromOpenAPI(openAPISpec, host);
                        const specInfo = createSpecInfoFromOpenAPI(openAPISpec);
                        const voiceConfig = getVoiceConfig(specInfo, tools);

                        // Send initial session configuration
                        connection.send(JSON.stringify(voiceConfig));

                        connection.send(
                            JSON.stringify({
                                type: 'response.create',
                                response: {
                                    instructions: 'Please introduce yourself with your capabilities briefly. And Speak in English Language',
                                },
                            }),
                        );
                    }
                });

                connection.on('message', async (message) => {
                    const parsedMessage = JSON.parse(message.toString());
                    if (parsedMessage?.type === 'response.done') {
                        // check output for function calls and other events
                        if (Array.isArray(parsedMessage.response.output)) {
                            parsedMessage?.response?.output?.forEach(async (output) => {
                                const isToolCall = output?.type === 'function_call';

                                // handle function calls
                                if (isToolCall) {
                                    const { name, arguments: args, call_id: functionCallId } = output;

                                    const agentDataConnector = ConnectorService.getAgentDataConnector();
                                    const openAPISpec = await agentDataConnector
                                        .getOpenAPIJSON(agentData, 'localhost', 'latest', true)
                                        .catch((error) => {
                                            console.error(error);
                                        });

                                    if (openAPISpec) {
                                        // Extract method and path from OpenAPI spec
                                        const pathEntry = Object.entries(openAPISpec.paths).find(
                                            ([path]) => path.split('/api/')[1] === name,
                                        );
                                        if (pathEntry) {
                                            const [path, methods] = pathEntry;
                                            const method = Object.keys(methods)[0];

                                            const toolResponse = await AgentProcess.load(agentData).run({
                                                method: method,
                                                path: path,
                                                body: JSON.parse(args),
                                            });

                                            const result = toolResponse?.data;

                                            const resultString = typeof result === 'string' ? result : JSON.stringify(result || null);

                                            const finalOutput = {
                                                dataPreview: resultString
                                                    ? resultString.substring(0, 200) + (resultString.length > 200 ? '...' : '')
                                                    : 'No data available',
                                                fullData: result,
                                            };

                                            connection.send(
                                                JSON.stringify({
                                                    type: 'conversation.item.create',
                                                    item: {
                                                        type: 'function_call_output',
                                                        call_id: functionCallId,
                                                        output: JSON.stringify(finalOutput),
                                                    },
                                                }),
                                            );

                                            connection.send(
                                                JSON.stringify({
                                                    type: 'response.create',
                                                }),
                                            );
                                        }
                                    }
                                }
                            });
                        }
                    }
                });

                res.json({
                    success: true,
                    message: 'WebSocket connection created successfully',
                    callId,
                });
            } catch (error) {
                console.error('Error creating WebSocket connection:', error);
                res.status(500).json({
                    error: 'Failed to create WebSocket connection',
                    details: error instanceof Error ? error.message : String(error),
                });
            }
        });
    }
}
