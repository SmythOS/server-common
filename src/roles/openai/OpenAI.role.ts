import { Readable } from 'stream';

import express from 'express';

import APIError from '@/APIError.class';
import { DEFAULT_AGENT_MODEL, DEFAULT_AGENT_MODEL_SETTINGS_KEY } from '@/constants';
import AgentLoader from '@/middlewares/AgentLoader.mw';
import { BaseRole } from '@/roles/Base.role';
import { chatService } from '@/roles/openai/Chat.service';
import type { ModelResolver } from '@/types/resolvers.types';

import { chatValidations } from './chat.validation';
import AgentDataAdapter from './middlewares/AgentDataAdapter.mw';
import { validate } from './middlewares/Validate.mw';
import { createOpenAIError, extractBearerToken } from './utils';

export class OpenAIRole extends BaseRole {
    /**
     * Creates a new OpenAIRole instance.
     * @param middlewares - Additional middlewares to apply after AgentDataAdapter and AgentLoader
     * @param options - Configuration options for the role
     * @param options.model - Optional model override: string for static model, or function to resolve model dynamically
     */
    constructor(middlewares: express.RequestHandler[] = [], options: { model?: ModelResolver } = {}) {
        super(middlewares, options);
    }

    public async mount(router: express.Router) {
        const middlewares = [AgentDataAdapter, AgentLoader, ...this.middlewares];

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

        router.post(
            '/v1/chat/completions',
            middlewares,
            validate(chatValidations.chatCompletion),
            async (req: express.Request, res: express.Response) => {
                try {
                    const agentData = req._agentData;
                    const agentSettings = req._agentSettings;

                    // Wait for agent settings to be ready
                    await agentSettings?.ready();

                    // Get base model from agent settings or use system default
                    const baseModel = agentSettings?.get(DEFAULT_AGENT_MODEL_SETTINGS_KEY) || DEFAULT_AGENT_MODEL;

                    // Apply model resolution strategy: static string, dynamic function, or default to base model
                    const model = this.resolve(this.options?.model, { baseModel, planInfo: agentData?.planInfo || {} }, baseModel);

                    const authHeader = req.headers['authorization'];
                    const apiKey = extractBearerToken(authHeader);

                    const skillHeaders = {};
                    if (req.headers['x-auth-token']) {
                        skillHeaders['X-AUTH-TOKEN'] = req.headers['x-auth-token'];
                    }

                    const result = await chatService.chatCompletion({
                        apiKey,
                        modelId: model,
                        params: req.body,
                        options: req.query,
                        skillHeaders,
                    });

                    if (result instanceof APIError) {
                        const error = createOpenAIError(result.statusCode, result);
                        return res.status(result.statusCode).json(error);
                    }

                    if (result instanceof Readable) {
                        // Handle streaming response: set headers for Server-Sent Events (SSE)
                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache');
                        res.setHeader('Connection', 'keep-alive');

                        result.on('error', (error: any) => {
                            console.warn('Chat completion streaming error:', error);
                            const status = error?.status || 500;
                            const apiError = createOpenAIError(status, error);
                            res.status(status).json(apiError);
                        });

                        // Pipe the stream to response
                        result.pipe(res);
                    } else {
                        // Handle non-streaming response
                        res.json(result);
                    }
                } catch (error) {
                    // Handle any unexpected errors
                    console.warn('Chat completion error:', error);
                    const status = error?.status || 500;
                    const apiError = createOpenAIError(status, error);
                    return res.status(status).json(apiError);
                }
            },
        );
    }
}
