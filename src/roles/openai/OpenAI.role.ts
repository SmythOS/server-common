// Node.js built-in modules
import { Readable } from 'stream';

// External packages
import express from 'express';

// Internal imports - parent directories
import { DEFAULT_AGENT_MODEL_SETTINGS_KEY, DEFAULT_AGENT_MODEL } from '../../constants';
import AgentLoader from '../../middlewares/AgentLoader.mw';
import { chatService } from '../../services/chat.service';
import APIError from '../../APIError.class';

// Internal imports - sibling directories
import { BaseRole } from '../Base.role';

// Internal imports - current directory
import { chatValidations } from './chat.validation';
import AgentDataAdapter from './middlewares/AgentDataAdapter.mw';
import { validate } from './middlewares/Validate.mw';
import { extractBearerToken, createOpenAIError } from './utils';

type ModelResolver = string | ((baseModel: string, planInfo: Record<string, any>) => string);

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

        router.post(
            '/v1/chat/completions',
            middlewares,
            validate(chatValidations.chatCompletion),
            async (req: express.Request, res: express.Response) => {
                try {
                    const agentData = (req as any)._agentData;
                    const agentSettings = (req as any)._agentSettings;

                    // Wait for agent settings to be ready
                    await agentSettings?.ready();

                    // Get base model from agent settings or use system default
                    const baseModel = agentSettings?.get(DEFAULT_AGENT_MODEL_SETTINGS_KEY) || DEFAULT_AGENT_MODEL;

                    // Apply model resolution strategy
                    let model: string;
                    if (typeof this.options?.model === 'function') {
                        // Dynamic: resolve model using custom function with base model and plan info
                        model = this.options.model(baseModel, agentData?.planInfo || {});
                    } else if (this.options?.model) {
                        // Static: use the specified model override
                        model = this.options.model;
                    } else {
                        // Default: use base model from agent settings
                        model = baseModel;
                    }

                    const authHeader = req.headers['authorization'];
                    const apiKey = extractBearerToken(authHeader);

                    const result = await chatService.chatCompletion({
                        apiKey,
                        modelId: model,
                        params: req.body,
                        options: req.query,
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
