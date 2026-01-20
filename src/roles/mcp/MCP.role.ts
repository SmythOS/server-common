import express from 'express';

import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';

import { AgentProcess, ConnectorService, Logger } from '@smythos/sdk/core';

import AgentLoader from '@/middlewares/AgentLoader.mw';
import { BaseRole } from '@/roles/Base.role';

import { extractMCPToolSchema, formatMCPSchemaProperties } from './MCP.service';

// TODO:
// * 1. Replace Deprecated Server with McpServer
// * 2. Implement StreamableHTTPServerTransport, and keep the SSEServerTransport for backward compatibility

const console = Logger('Role: MCP');

const clientTransports = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

export class MCPRole extends BaseRole {
    /**
     * Creates a new MCPRole instance.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role. Defaults to an empty object.
     */
    constructor(middlewares: express.RequestHandler[] = [], options: Record<string, unknown> = {}) {
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

        router.get('/sse', middlewares, async (req: express.Request, res: express.Response) => {
            try {
                const agentData = req._agentData;

                const agentDataConnector = ConnectorService.getAgentDataConnector();
                const openAPISpec = await agentDataConnector.getOpenAPIJSON(agentData, 'localhost', 'latest', true);

                // Server implementation
                const server = new McpServer(
                    {
                        name: openAPISpec.info.title,
                        version: openAPISpec.info.version,
                    },
                    {
                        capabilities: {
                            tools: {},
                        },
                    },
                );
                req.on('error', (error: unknown) => {
                    console.error('Error:', error);
                    // server.close();
                });

                // Handle client disconnect
                req.on('close', () => {
                    console.log('Client disconnected');
                    clientTransports.delete(transport.sessionId);
                    // server.close();
                });

                server.onerror = (error: unknown) => {
                    console.error('Server error:', error);
                    // server.close();
                };

                server.onclose = async () => {
                    console.log('Server closing');
                    // await server.close();
                    // process.exit(0);
                };
                // Extract available endpoints and their methods
                const tools: Tool[] = Object.entries(openAPISpec.paths).map(([path, methods]) => {
                    const method = Object.keys(methods)[0];
                    const endpoint = path.split('/api/')[1];
                    const operation = methods[method];
                    const schema = extractMCPToolSchema(operation, method);
                    const properties = formatMCPSchemaProperties(schema);

                    return {
                        name: endpoint,
                        description:
                            operation.summary ||
                            `Endpoint that handles ${method.toUpperCase()} requests to ${endpoint}. ` + `${schema?.description || ''}`,
                        inputSchema: {
                            type: 'object',
                            properties: properties,
                            required: schema?.required || [],
                        },
                    };
                });

                // Tool handlers
                server.setRequestHandler(ListToolsRequestSchema, async () => ({
                    tools,
                }));

                server.setRequestHandler(CallToolRequestSchema, async (request) => {
                    try {
                        const { name, arguments: args } = request.params;

                        if (!args) {
                            throw new Error('No arguments provided');
                        }

                        // Find the matching tool from our tools array
                        const tool = tools.find((t) => t.name === name);
                        if (!tool) {
                            return {
                                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                                isError: true,
                            };
                        }

                        try {
                            // Extract method and path from OpenAPI spec
                            const pathEntry = Object.entries(openAPISpec.paths).find(([path]) => path.split('/api/')[1] === name);
                            if (!pathEntry) {
                                throw new Error(`Could not find path for tool: ${name}`);
                            }

                            const [path, methods] = pathEntry;
                            const method = Object.keys(methods)[0];

                            // Process the request through the agent
                            const result = await AgentProcess.load(agentData).run({
                                method: method,
                                path: path,
                                body: args,
                                headers: {
                                    'X-AUTH-TOKEN': req.headers['x-auth-token'],
                                },
                            });

                            return {
                                content: [{ type: 'text', text: JSON.stringify(result) }],
                                isError: false,
                            };
                        } catch (error) {
                            return {
                                content: [{ type: 'text', text: `Error processing request: ${error.message}` }],
                                isError: true,
                            };
                        }
                    } catch (error) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                                },
                            ],
                            isError: true,
                        };
                    }
                });

                const transport = new SSEServerTransport('/emb/mcp/message', res);
                await server.connect(transport);

                clientTransports.set(transport.sessionId, { transport, server });
                console.log('Generated sessionId', transport.sessionId);
                console.log('MCP Server running on sse');
            } catch (error: unknown) {
                console.error(error);
                return res.status(500).send({ error: (error as Error).message });
            }
        });

        router.post('/message', async (req: express.Request, res: express.Response) => {
            const sessionId = req.query.sessionId;
            console.log('Received sessionId', sessionId);
            const transport = clientTransports.get(sessionId as string)?.transport;
            if (!transport) {
                return res.status(404).send({ error: 'Transport not found' });
            }
            await transport.handlePostMessage(req, res, req.body);
        });
    }
}
