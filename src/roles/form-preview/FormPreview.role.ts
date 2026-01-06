import axios, { AxiosError } from 'axios';
import express from 'express';

import AgentLoader from '@/middlewares/AgentLoader.mw';
import { BaseRole } from '@/roles/Base.role';

export class FormPreviewRole extends BaseRole {
    /**
     * Creates a new FormPreviewRole instance.
     * @param middlewares - Custom middlewares to apply to the role on top of the default middlewares.
     * @param options - Configuration options for the role.
     * @param options.port - The port for the runtime server. Can be a static string or a function that resolves the port from the request.
     * @param options.runtimeUrl - The base URL for the runtime server. Can be a static string or a function that resolves the URL from the request.
     * @param options.authToken - Optional authentication token for API calls. Can be a static string or a function that resolves the token from the request and agent ID.
     * @param options.beforeMount - Optional callback executed before mounting routes, useful for adding custom middleware or routes.
     */
    constructor(
        middlewares: express.RequestHandler[] = [],
        options: {
            port: string | ((req: express.Request) => string | undefined);
            runtimeUrl: string | ((req: express.Request) => string);
            authToken?: string | ((req: express.Request, agentId: string) => string);
            beforeMount?: (router: express.Router) => Promise<void>;
        },
    ) {
        super(middlewares, options);
    }

    /**
     * Mounts the form preview endpoints on the provided router.
     *
     * Creates three routes:
     * 1. GET / - Serves an HTML page with the embedded form preview interface
     * 2. GET /params - Returns agent configuration data (id, name, components, domain, port, outputPreview)
     * 3. POST /call-skill - Executes a skill by calling the runtime server with the provided componentId and payload
     *
     * All routes use AgentLoader middleware to load agent data and settings.
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
        if (typeof this.options.beforeMount === 'function') {
            await this.options.beforeMount(router);
        }

        router.get('/', async (req, res) => {
            const agentData = req._agentData;
            // Set Permissions-Policy header to allow storage access in iframe
            res.setHeader('Permissions-Policy', 'storage-access=*');

            res.send(`
<!doctype html>
<html lang="en" style="height: 100%;margin: 0;padding: 0;">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link  rel="icon" type="image/png" href="/static/img/icon.svg" />
  <title>${agentData.name}</title>
</head>
<body style="height: 100%;margin: 0;padding: 0;">
  <div id="form-preview-container" style="height: 100%;"></div>
  <script src="/static/embodiment/formPreview/form-preview-minified.js"></script>
  <script>
      FormPreview.init({
          domain:'${req.hostname}?endpointId=${req?.query?.endpointId || ''}&type=${req?.query?.type || ''}&style=${req?.query?.style || ''}',
          containerId: 'form-preview-container',
      });
  </script>
</body>
</html>`);
        });

        router.get('/params', async (req, res) => {
            const agentData = req._agentData;
            const agentSettings = req._agentSettings;

            const promises = [agentSettings?.ready()];

            await Promise.all(promises);

            const agentId = agentData.id;
            const outputPreview = agentSettings?.embodiments?.get('form')?.outputPreview || false;

            const port = this.resolve(this.options.port, req);

            const agentDataResponse = {
                id: agentId,
                name: agentData.name,
                components: agentData.components,
                domain: agentData.domain,
                port,
                outputPreview,
            };

            res.send(agentDataResponse);
        });

        router.post('/call-skill', async (req, res) => {
            const agentData = req._agentData;

            const agentId = agentData.id;
            const { componentId, payload, version } = req.body;

            const component = agentData.components.find((c) => c.id === componentId);

            if (!component) {
                res.status(404).send({ error: 'Component not found' });
            }

            const authToken = this.resolve(this.options.authToken, req, agentId);
            const runtimeUrl = this.resolve(this.options.runtimeUrl, req);

            let url = `${runtimeUrl}/api/${component.data.endpoint!}`;

            if (authToken) {
                url += `?token=${authToken}`;
            }

            const body = JSON.stringify(payload || {});

            const headers = {
                'X-AGENT-ID': agentId,
            };

            // if version is dev, don't send it
            if (version !== 'dev') {
                headers['X-AGENT-VERSION'] = version;
            }

            try {
                const result = await axios.post(url, body, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-DEBUG-SKIP': 'true',
                        ...headers,
                    },
                });
                res.status(200).json({ response: result.data });
            } catch (error) {
                const axiosErr = error as AxiosError;
                return res.status(error.response?.status || 500).json({ error: axiosErr.response?.data || axiosErr.message });
            }
        });
    }
}
