import express from 'express';
import Converter from 'openapi-to-postmanv2';

import { ConnectorService } from '@smythos/sdk/core';

import { BaseRole } from '../Base.role';
import AgentLoader from '../../middlewares/AgentLoader.mw';

export class PostmanRole extends BaseRole {
    /**
     * Creates a new PostmanRole instance.
     * @param middlewares - Custom middlewares to apply to the role on top of the default middlewares.
     * @param options - Configuration options for the role.
     * @param options.serverOrigin - The server origin URL. Can be a string or a function that accepts the request and returns a string.
     *                                Used to generate the correct base URL in the OpenAPI spec before conversion.
     *                                Defaults to an empty string.
     */
    constructor(middlewares: express.RequestHandler[], options: { serverOrigin: string | Function }) {
        super(middlewares, options);
    }

    /**
     * Mounts the Postman collection endpoint on the provided router.
     *
     * Creates a GET route that:
     * 1. Loads agent data via AgentLoader middleware
     * 2. Fetches the agent's OpenAPI specification
     * 3. Converts the OpenAPI spec to Postman collection format using openapi-to-postmanv2
     * 4. Returns the Postman collection as a downloadable JSON file
     *
     * @param router - The Express router to mount the endpoint on.
     * @throws Returns 500 error if OpenAPI spec retrieval or conversion fails.
     */
    public async mount(router: express.Router) {
        const middlewares = [AgentLoader, ...this.middlewares];

        router.get('/', middlewares, async (req: any, res) => {
            let domain = req.hostname;
            const agentData = (req as any)._agentData;
            try {
                const serverOrigin = typeof this.options.serverOrigin === 'function' ? this.options.serverOrigin(req) : this.options.serverOrigin;

                const agentDataConnector = ConnectorService.getAgentDataConnector();
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
