import express from 'express';

import { ConnectorService } from '@smythos/sdk/core';

import AgentLoader from '@/middlewares/AgentLoader.mw';

import { BaseRole } from '../Base.role';

export class OpenAPIRole extends BaseRole {
    /**
     * Creates a new OpenAPIRole instance.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role. Defaults to an empty object.
     */
    constructor(middlewares: express.RequestHandler[] = [], options: Record<string, string | ((req: express.Request) => string)> = {}) {
        super(middlewares, options);
    }

    public async mount(router: express.Router) {
        const middlewares = [AgentLoader, ...this.middlewares];

        router.get('/api-docs/openapi.json', middlewares, openapiJSONHandler);
        router.get('/api-docs/openapi-llm.json', middlewares, openapiJSON4LLMHandler);
    }
}

async function openapiJSONHandler(req: express.Request, res: express.Response) {
    const domain = req.hostname;
    const agentData = (req as any)._agentData;

    const agentDataConnector = ConnectorService.getAgentDataConnector();
    const openAPIObj = await agentDataConnector.getOpenAPIJSON(agentData, domain, req._agentVersion, false).catch((error) => {
        console.error(error);
        return { error: error.message };
    });

    if (openAPIObj?.error) {
        return res.status(500).send({ error: openAPIObj.error });
    }
    // set application type to json
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(openAPIObj, null, 2));
}

async function openapiJSON4LLMHandler(req: express.Request, res: express.Response) {
    const domain = req.hostname;
    const agentData = (req as any)._agentData;

    const agentDataConnector = ConnectorService.getAgentDataConnector();
    const openAPIObj = await agentDataConnector.getOpenAPIJSON(agentData, domain, req._agentVersion, true).catch((error) => {
        console.error(error);
        return { error: error.message };
    });

    if (openAPIObj?.error) {
        return res.status(500).send({ error: openAPIObj.error });
    }
    // set application type to json
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(openAPIObj, null, 2));
}
