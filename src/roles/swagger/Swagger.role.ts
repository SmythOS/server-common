import { BaseRole } from '../Base.role';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { ConnectorService } from '@smythos/sdk/core';
import AgentLoader from '../../middlewares/AgentLoader.mw';
import { constructServerUrl } from '../../utils/url.utils';

export class SwaggerRole extends BaseRole {
    /**
     * Creates a new SwaggerRole instance.
     * @param router - The router to mount the role on.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role.
     * Accepts:
     * - staticPath: The path to the static files for the role. this assumes that a static route is mounted and the swagger files (swagger.js, swagger-debug.js) are served from this path.
     * Defaults to '/static/embodiment/swagger'.
     */
    constructor(middlewares: express.RequestHandler[], options: { staticPath?: string } = { staticPath: '/static/embodiment/swagger' }) {
        super(middlewares, options);
    }
    public async mount(router: express.Router) {
        const middlewares = [AgentLoader, ...this.middlewares];
        router.use('/', swaggerUi.serve);
        router.use('/', middlewares, async (req: any, res) => {
            //TODO : handle release switch : dev, prod, prod old versions [DONE]
            const agentData = (req as any)._agentData;
            let domain = req.hostname;
            // const debugSessionEnabled = agent.debugSessionEnabled;
            const isTestDomain = agentData.usingTestDomain;
            //const openApiDocument = await getOpenAPIJSON(agentData, domain, req._agentVersion, false);

            const server_url = constructServerUrl(domain);
            const agentDataConnector = ConnectorService.getAgentDataConnector();
            const openApiDocument = await agentDataConnector.getOpenAPIJSON(agentData, server_url, agentData.version, false);

            if (agentData?.auth?.method && agentData?.auth?.method != 'none') {
                // Add or update security definitions
                openApiDocument.components = openApiDocument.components || {};
                openApiDocument.components.securitySchemes = {
                    ApiKeyAuth: {
                        type: 'apiKey',
                        in: 'header',
                        name: 'Authorization',
                    },
                };
                openApiDocument.security = [{ ApiKeyAuth: [] }];
            }

            let htmlContent = swaggerUi.generateHTML(openApiDocument);

            let debugScript = `<script src="${this.options.staticPath}/swagger.js"></script>`;
            if (isTestDomain) {
                debugScript += `
<script src="${this.options.staticPath}/swagger-debug.js"></script>
<script>
initDebug('${process.env.UI_SERVER}', '${agentData.id}');
</script>
`;
            }

            //inject the debug script before closing body tag
            htmlContent = htmlContent.replace('</body>', `${debugScript}</body>`);
            res.send(htmlContent);
        });
    }
}
