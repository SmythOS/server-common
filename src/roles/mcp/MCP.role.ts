import { randomUUID } from 'node:crypto';

import express from 'express';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';

import { AgentProcess, ConnectorService } from '@smythos/sdk/core';

import AgentLoader from '@/middlewares/AgentLoader.mw';
import { BaseRole } from '@/roles/Base.role';

import { extractMCPToolSchema, formatMCPSchemaProperties, isMcpEnabled } from './MCP.service';

type TransportUnion = SSEServerTransport | StreamableHTTPServerTransport;
const clientTransports = new Map<string, { transport: TransportUnion; server: McpServer }>();
const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

export class MCPRole extends BaseRole {
    /**
     * Creates a new MCPRole instance.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role. Defaults to an empty object.
     */
    constructor(middlewares: express.RequestHandler[] = [], options: Record<string, unknown> = {}) {
        super(middlewares, options);
    }

    /**
     * Creates and configures an MCP server with tools from the agent's OpenAPI spec
     */
    private async createMCPServer(agentData: any, agentSettings: any): Promise<{ mcpServer: McpServer; tools: Tool[] }> {
        await agentSettings?.ready();
        const isEnabled = isMcpEnabled(agentData, agentSettings);
        if (!isEnabled) {
            throw new Error('MCP is not enabled for this agent');
        }

        const agentDataConnector = ConnectorService.getAgentDataConnector();
        const openAPISpec = await agentDataConnector.getOpenAPIJSON(agentData, 'localhost', 'latest', true);

        // Server implementation
        const mcpServer = new McpServer(
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
        mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools,
        }));

        mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

        return { mcpServer, tools };
    }

    public async mount(router: express.Router) {
        const middlewares = [AgentLoader, ...this.middlewares];

        // Modern Streamable HTTP endpoint - handles all HTTP methods
        router.all('/mcp', middlewares, async (req: express.Request, res: express.Response) => {
            try {
                const agentData = req._agentData;
                const agentSettings = req._agentSettings;
                if (agentData?.auth?.method && agentData?.auth?.method !== 'none') {
                    return res.status(400).send({ error: 'Agents with authentication enabled are not supported for MCP' });
                }

                const { mcpServer } = await this.createMCPServer(agentData, agentSettings);

                // Set up error handlers
                req.on('error', (error: any) => {
                    console.error('Streamable HTTP transport error:', error);
                });

                mcpServer.server.onerror = (error: any) => {
                    console.error('MCP Server error:', error);
                };

                mcpServer.server.onclose = async () => {
                    console.log('MCP Server closing (Streamable HTTP)');
                };

                // Create Streamable HTTP transport
                // StreamableHTTPServerTransport requires an options object with sessionIdGenerator
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                });
                const sessionId = transport.sessionId;

                // Handle client disconnect
                req.on('close', () => {
                    console.log('Client disconnected (Streamable HTTP)');
                    streamableTransports.delete(sessionId);
                    clientTransports.delete(sessionId);
                });

                await mcpServer.connect(transport);

                streamableTransports.set(sessionId, transport);
                clientTransports.set(sessionId, { transport, server: mcpServer });

                console.log('Generated sessionId (Streamable HTTP):', sessionId);
                console.log('MCP Server running on Streamable HTTP');
            } catch (error: any) {
                console.error('Streamable HTTP transport error:', error);
                return res.status(error.message?.includes('not enabled') ? 503 : 500).send({ error: error.message });
            }
        });

        // Legacy SSE endpoint for backwards compatibility
        router.get('/sse', middlewares, async (req: express.Request, res: express.Response) => {
            try {
                const agentData = req._agentData;
                const agentSettings = req._agentSettings;
                if (agentData?.auth?.method && agentData?.auth?.method !== 'none') {
                    return res.status(400).send({ error: 'Agents with authentication enabled are not supported for MCP' });
                }

                const { mcpServer } = await this.createMCPServer(agentData, agentSettings);

                // Set up error handlers
                req.on('error', (error: any) => {
                    console.error('SSE transport error:', error);
                });

                // Handle client disconnect
                req.on('close', () => {
                    console.log('Client disconnected (SSE)');
                    // transport will be cleaned up in the close handler below
                });

                mcpServer.server.onerror = (error: any) => {
                    console.error('MCP Server error:', error);
                };

                mcpServer.server.onclose = async () => {
                    console.log('MCP Server closing (SSE)');
                };

                const transport = new SSEServerTransport('/emb/mcp/message', res);
                await mcpServer.connect(transport);

                // Handle SSE transport cleanup
                req.on('close', () => {
                    clientTransports.delete(transport.sessionId);
                });

                clientTransports.set(transport.sessionId, { transport, server: mcpServer });
                console.log('Generated sessionId (SSE):', transport.sessionId);
                console.log('MCP Server running on SSE (legacy)');
            } catch (error: any) {
                console.error('SSE transport error:', error);
                return res.status(error.message?.includes('not enabled') ? 503 : 500).send({ error: error.message });
            }
        });

        // Legacy SSE message endpoint (only needed for SSE transport)
        router.post('/message', middlewares, async (req, res) => {
            const sessionId = req.query.sessionId;
            console.log('Received sessionId (SSE message):', sessionId);
            const transportEntry = clientTransports.get(sessionId as string);
            if (!transportEntry) {
                return res.status(404).send({ error: 'Transport not found' });
            }

            // Only SSE transport has handlePostMessage method
            if (transportEntry.transport instanceof SSEServerTransport) {
                await transportEntry.transport.handlePostMessage(req, res, req.body);
            } else {
                return res.status(400).send({ error: 'This endpoint is only for SSE transport' });
            }
        });
    }
}
