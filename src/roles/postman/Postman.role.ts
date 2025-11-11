import express from 'express';
import Converter from 'openapi-to-postmanv2';

import { ConnectorService } from '@smythos/sdk/core';

import { BaseRole } from '../Base.role';
import AgentLoader from '../../middlewares/AgentLoader.mw';

export class PostmanRole extends BaseRole {
    /**
     * Creates a new SwaggerRole instance.
     * @param router - The router to mount the role on.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role.
     * Accepts:
     * - staticPath: The path to the static files for the role. this assumes that a static route is mounted and the swagger files (swagger.js, swagger-debug.js) are served from this path.
     * Defaults to '/static/embodiment/swagger'.
     */
    constructor(middlewares: express.RequestHandler[], options: Record<string, string | Function> = { serverOrigin: () => '' }) {
        super(middlewares, options);
    }

    public async mount(router: express.Router) {
        const middlewares = [AgentLoader, ...this.middlewares];

        router.get('/', middlewares, async (req: any, res) => {
            let domain = req.hostname;
            const agentData = (req as any)._agentData;
            try {
                const agentDataConnector = ConnectorService.getAgentDataConnector();
                const serverOrigin = typeof this.options.serverOrigin === 'function' ? this.options.serverOrigin(req) : this.options.serverOrigin;

                const openAPISpec = await agentDataConnector.getOpenAPIJSON(agentData, serverOrigin, agentData.version, false).catch((error) => {
                    console.error(error);
                    return { error: error.message };
                });

                if (openAPISpec?.error) {
                    return res.status(500).send({ error: openAPISpec.error });
                }

                const conversionResult: any = await new Promise((resolve, reject) => {
                    Converter.convert({ type: 'json', data: openAPISpec }, {}, (err, result) => {
                        if (err) {
                            reject(err);
                        } else if (result.result) {
                            resolve(result);
                        } else {
                            reject(new Error(`Conversion failed: ${result.reason}`));
                        }
                    });
                });

                // Force download the generated Postman collection
                const filename = `${agentData.name}.postman.json`; // Specify the filename here
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(conversionResult?.output?.[0]?.data, null, 2));
            } catch (error: any) {
                console.error(error);
                return res.status(500).send({ error: error.message });
            }
        });
    }
}
