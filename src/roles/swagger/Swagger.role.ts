import { BaseRole } from '../Base.role';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { ConnectorService } from '@smythos/sdk/core';
import AgentLoader from '../../middlewares/AgentLoader.mw';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SwaggerRole extends BaseRole {
    private swaggerJsContent: string;
    private swaggerDebugJsContent: string;

    /**
     * Creates a new SwaggerRole instance.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role.
     * Accepts:
     * - serverOrigin: The server origin URL (string or function that returns the URL)
     */
    constructor(middlewares: express.RequestHandler[], options: { serverOrigin?: string | Function } = { serverOrigin: () => '' }) {
        super(middlewares, options);

        // Load the swagger JS files at initialization
        try {
            this.swaggerJsContent = fs.readFileSync(path.join(__dirname, 'assets', 'swagger.js'), 'utf-8');
            this.swaggerDebugJsContent = fs.readFileSync(path.join(__dirname, 'assets', 'swagger-debug.js'), 'utf-8');
        } catch (error) {
            console.error('Failed to load swagger JS files:', error);
            this.swaggerJsContent = '';
            this.swaggerDebugJsContent = '';
        }
    }
    public async mount(router: express.Router) {
        const middlewares = [AgentLoader, ...this.middlewares];

        // Serve swagger.js file
        router.get('/_swagger-assets/swagger.js', (req, res) => {
            res.setHeader('Content-Type', 'application/javascript');
            res.send(this.swaggerJsContent);
        });

        // Serve swagger-debug.js file
        router.get('/_swagger-assets/swagger-debug.js', (req, res) => {
            res.setHeader('Content-Type', 'application/javascript');
            res.send(this.swaggerDebugJsContent);
        });

        router.use('/', swaggerUi.serve);
        router.use('/', middlewares, async (req: any, res) => {
            const agentData = (req as any)._agentData;
            const isTestDomain = agentData.usingTestDomain;

            const serverOrigin = typeof this.options.serverOrigin === 'function' ? this.options.serverOrigin(req) : this.options.serverOrigin;

            const agentDataConnector = ConnectorService.getAgentDataConnector();
            const openApiDocument = await agentDataConnector.getOpenAPIJSON(agentData, serverOrigin, agentData.version, false);

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

            // Inject swagger scripts with self-contained paths
            let debugScript = `<script src="/_swagger-assets/swagger.js"></script>`;
            if (isTestDomain) {
                debugScript += `
<script src="/_swagger-assets/swagger-debug.js"></script>
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
