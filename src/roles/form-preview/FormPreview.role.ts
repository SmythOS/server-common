import axios, { AxiosError } from 'axios';
import express from 'express';

import AgentLoader from '@/middlewares/AgentLoader.mw';
import { BaseRole } from '@/roles/Base.role';

export class FormPreviewRole extends BaseRole {
    /**
     * Creates a new FormPreviewRole instance.
     * @param middlewares - Custom middlewares to apply to the role on top of the default middlewares.
     * @param options - Configuration options for the role.
     * @param options.staticPath - The path to the form preview static files. Defaults to '/static/embodiment/formPreview'.
     * @param options.scriptPath - The path to the form preview script. Defaults to staticPath + '/form-preview-minified.js'.
     */
    constructor(middlewares: express.RequestHandler[] = [], options: { port: number } = { port: 3000 }) {
        super(middlewares, options);
    }

    /**
     * Mounts the form preview endpoint on the provided router.
     *
     * Creates a GET route that:
     * 1. Loads agent data via AgentLoader middleware
     * 2. Serves an HTML page with an embedded form preview interface
     * 3. Initializes the FormPreview client-side component with agent configuration
     *
     * @param router - The Express router to mount the endpoint on.
     */
    public async mount(router: express.Router) {
        const middlewares = [AgentLoader, ...this.middlewares];

        router.get('/', middlewares, async (req, res) => {
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

        router.get('/params', middlewares, async (req, res) => {
            const agentData = req._agentData;
            const agentSettings = req._agentSettings;

            const promises = [agentSettings?.ready()];

            await Promise.all(promises);

            const agentId = agentData.id;
            const outputPreview = agentSettings?.embodiments?.get('form')?.outputPreview || false;

            const agentDataResponse = {
                id: agentId,
                name: agentData.name,
                components: agentData.components,
                domain: agentData.domain,
                port: this.options.port,
                outputPreview,
            };

            res.send(agentDataResponse);
        });

        router.post('/call-skill', middlewares, async (req, res) => {
            const agentData = req._agentData;

            const agentId = agentData.id;
            const { componentId, payload, version } = req.body;

            const component = agentData.components.find((c) => c.id === componentId);

            if (!component) {
                res.status(404).send({ error: 'Component not found' });
            }

            const authToken = this.options.authToken;

            let url = `${this.options.runtimeUrl}/api/${component.data.endpoint!}`;

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

// TODO: Remove if it's not mandatory to have response even callSkill fails
type CallSkillParams = {
    url: string;
    body: string;
    headers: { [key: string]: string };
};

export async function callSkill({ url, body, headers }: CallSkillParams) {
    try {
        const res = await axios.post(url, body, {
            headers: {
                'Content-Type': 'application/json',
                'X-DEBUG-SKIP': 'true',
                ...headers,
            },
        });
        return res.data;
    } catch (error) {
        const axiosErr = error as AxiosError;
        return axiosErr.response?.data || axiosErr.message;
    }
}
