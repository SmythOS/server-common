import express from 'express';

import { DEFAULT_AGENT_MODEL, DEFAULT_AGENT_MODEL_SETTINGS_KEY } from '@/constants';
import AgentLoader from '@/middlewares/AgentLoader.mw';
import { BaseRole } from '@/roles/Base.role';
import type { ModelResolver, ServerOriginResolver } from '@/types/resolvers.types';

import { createAlexaSkill, handleAlexaRequest, isAlexaEnabled, parseAlexaRequest } from './Alexa.service';

export class AlexaRole extends BaseRole {
    /**
     * Creates a new AlexaRole instance.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role
     * @param options.serverOrigin - Server origin URL: string for static, or function to resolve dynamically from request
     * @param options.model - Optional model override: string for static model, or function to resolve model dynamically
     */
    constructor(
        middlewares: express.RequestHandler[] = [],
        options: { serverOrigin: ServerOriginResolver; model?: ModelResolver; beforeMount?: (router: express.Router) => Promise<void> },
    ) {
        super(middlewares, options);
    }

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

        router.post('/', middlewares, async (req: express.Request, res: express.Response) => {
            try {
                const agentData = req._agentData;
                const agentSettings = req._agentSettings;
                await agentSettings?.ready();
                const isEnabled = isAlexaEnabled(agentData, agentSettings);
                // wait for agent embodiments to be ready
                await agentSettings?.embodiments?.ready();

                // Resolve server origin: static string or dynamic from request
                const serverOrigin = this.resolve(this.options.serverOrigin, req);

                const alexRequest = parseAlexaRequest(req.body);

                // Get base model from agent settings or use system default
                const baseModel = agentSettings?.get(DEFAULT_AGENT_MODEL_SETTINGS_KEY) || DEFAULT_AGENT_MODEL;

                // Apply model resolution strategy: static string, dynamic function, or default to base model
                const model = this.resolve(this.options?.model, { baseModel, planInfo: agentData?.planInfo || {} }, baseModel);

                const skillHeaders = {};
                if (req.headers['x-auth-token']) {
                    skillHeaders['X-AUTH-TOKEN'] = req.headers['x-auth-token'];
                }

                const response = await handleAlexaRequest({
                    isEnabled,
                    model,
                    alexRequest,
                    agentData,
                    serverOrigin,
                    skillHeaders,
                });

                res.json(response);
            } catch (error: unknown) {
                console.error(error);
                return res.status(500).send({ error: (error as Error).message });
            }
        });

        router.post('/publish', middlewares, async (req: express.Request, res: express.Response) => {
            try {
                const agentData = req._agentData;
                const agentName = agentData.name;
                const agentDomain = agentData.domain;
                const accessToken = req.body.accessToken;
                const vendorId = req.body.vendorId;
                const scheme = agentDomain.includes(':') ? 'http' : 'https';
                const endpoint = `${scheme}://${agentDomain}/alexa`;

                await createAlexaSkill(agentName, accessToken, vendorId, endpoint);

                return res.json({ success: true, message: 'Agent published to Alexa successfully' });
            } catch (error: unknown) {
                console.error('Error publishing to Alexa:', error);
                return res.status(500).json({ success: false, error: (error as Error).message });
            }
        });
    }
}
