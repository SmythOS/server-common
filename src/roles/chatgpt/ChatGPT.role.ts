import express from 'express';

import { ConnectorService } from '@smythos/sdk/core';

import AgentLoader from '@/middlewares/AgentLoader.mw';
import { BaseRole } from '@/roles/Base.role';

export class ChatGPTRole extends BaseRole {
    /**
     * Creates a new ChatGPTRole instance.
     *
     * This role provides ChatGPT-compatible OpenAPI specifications for SmythOS agents.
     * It transforms the standard OpenAPI 3.0.1 spec to 3.1.0 format required by ChatGPT Actions,
     * and handles GPT-specific limitations (e.g., 300 character summary limits).
     *
     * @param middlewares - Custom middlewares to apply on top of default middlewares
     * @param options - Configuration options for the role
     * @param options.serverOrigin - Server origin URL (string or function that returns string from request)
     *                                Used for generating absolute URLs in the OpenAPI spec
     */
    constructor(middlewares: express.RequestHandler[], options: { serverOrigin: string | ((req: express.Request) => string) }) {
        super(middlewares, options);
    }

    /**
     * Mounts the ChatGPT role routes on the provided router.
     *
     * Registers a GET endpoint at `/api-docs/openapi-gpt.json` that serves
     * a ChatGPT-compatible OpenAPI 3.1.0 specification for the agent.
     *
     * @param router - Express router to mount the routes on
     */
    public async mount(router: express.Router) {
        const middlewares = [AgentLoader, ...this.middlewares];

        router.get('/api-docs/openapi-gpt.json', middlewares, async (req: express.Request, res: express.Response) => {
            const agentData = req._agentData;

            // Resolve server origin from options (static value or dynamic function)
            const serverOrigin = this.resolve(this.options.serverOrigin, { args: req });

            // Fetch the base OpenAPI 3.0.1 specification from agent data
            const agentDataConnector = ConnectorService.getAgentDataConnector();
            const openAPIObj = await agentDataConnector.getOpenAPIJSON(agentData, serverOrigin, agentData.version, false);

            if (openAPIObj?.error) {
                return res.status(500).send({ error: openAPIObj.error });
            }

            // Transform from OpenAPI 3.0.1 to 3.1.0 format for ChatGPT Actions compatibility
            const transformedSpec = transformOpenAPI301to310(openAPIObj);

            // ChatGPT Actions has a 300 character limit for operation summaries
            // Truncate summaries at sentence boundaries to fit within this limit
            // TODO: Consider using an LLM to intelligently rephrase summaries instead of truncating
            if ('paths' in transformedSpec) {
                for (const path in transformedSpec.paths) {
                    const entry = transformedSpec.paths[path];
                    for (const method in entry) {
                        if (!entry[method].summary) continue;
                        entry[method].summary = splitOnSeparator(entry[method].summary, 300, '.');
                    }
                }
            }

            // Return the transformed OpenAPI specification as JSON
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(transformedSpec, null, 2));
        });
    }
}

/**
 * Transforms OpenAPI 3.0.1 specification to 3.1.0 format
 *
 * Key transformations:
 * - Updates version number to '3.1.0'
 * - Converts `nullable: true` to union types with 'null'
 * - Handles binary format by converting to base64 string with `contentEncoding`
 * - Fixes empty array items by defaulting to string type
 * - Transforms empty `additionalProperties` objects to `true`
 * - Recursively processes all schemas in paths, components, request bodies, responses, and parameters
 * - Handles nested schema structures (allOf, oneOf, anyOf, not)
 *
 * @param spec - The OpenAPI 3.0.1 specification object
 * @returns The transformed OpenAPI 3.1.0 specification
 */
function transformOpenAPI301to310(spec: any): any {
    // Deep clone to avoid mutating original
    const transformed = JSON.parse(JSON.stringify(spec));

    // Update version
    transformed.openapi = '3.1.0';

    // Transform schemas recursively
    function transformSchema(schema: any): any {
        if (!schema || typeof schema !== 'object') return schema;

        // Handle array schemas - ensure items is properly defined
        if (schema.type === 'array') {
            if (!schema.items || Object.keys(schema.items).length === 0) {
                schema.items = { type: 'string' }; // Default to string items
            } else {
                schema.items = transformSchema(schema.items);
            }
        }

        // Handle object schemas - fix empty additionalProperties
        if (schema.type === 'object') {
            if (
                schema.additionalProperties !== undefined &&
                typeof schema.additionalProperties === 'object' &&
                Object.keys(schema.additionalProperties).length === 0
            ) {
                schema.additionalProperties = true; // Allow any additional properties
            }

            // Transform nested properties
            if (schema.properties) {
                for (const [key, prop] of Object.entries(schema.properties)) {
                    schema.properties[key] = transformSchema(prop);
                }
            }
        }

        // Handle binary format - convert to string with contentEncoding
        if (schema.format === 'binary') {
            delete schema.format;
            schema.type = 'string';
            schema.contentEncoding = 'base64';
        }

        // Handle nullable fields (3.0.1 -> 3.1.0)
        if (schema.nullable === true) {
            delete schema.nullable;
            // Convert to union type with null
            if (schema.type) {
                schema.type = Array.isArray(schema.type) ? [...schema.type, 'null'] : [schema.type, 'null'];
            }
        }

        // Recursively transform nested schemas
        if (schema.allOf) schema.allOf = schema.allOf.map(transformSchema);
        if (schema.oneOf) schema.oneOf = schema.oneOf.map(transformSchema);
        if (schema.anyOf) schema.anyOf = schema.anyOf.map(transformSchema);
        if (schema.not) schema.not = transformSchema(schema.not);

        return schema;
    }

    // Transform request/response schemas in paths
    if (transformed.paths) {
        for (const pathItem of Object.values(transformed.paths)) {
            for (const operation of Object.values(pathItem as any)) {
                if (typeof operation !== 'object' || !operation) continue;

                const op = operation as any;

                // Transform request body schemas
                if (op.requestBody?.content) {
                    for (const mediaObj of Object.values(op.requestBody.content)) {
                        if ((mediaObj as any).schema) {
                            (mediaObj as any).schema = transformSchema((mediaObj as any).schema);
                        }
                    }
                }

                // Transform response schemas
                if (op.responses) {
                    for (const response of Object.values(op.responses)) {
                        if ((response as any).content) {
                            for (const mediaObj of Object.values((response as any).content)) {
                                if ((mediaObj as any).schema) {
                                    (mediaObj as any).schema = transformSchema((mediaObj as any).schema);
                                }
                            }
                        }
                    }
                }

                // Transform parameter schemas
                if (op.parameters) {
                    op.parameters = op.parameters.map((param: any) => {
                        if (param.schema) {
                            param.schema = transformSchema(param.schema);
                        }
                        return param;
                    });
                }
            }
        }
    }

    // Transform component schemas
    if (transformed.components?.schemas) {
        for (const [name, schema] of Object.entries(transformed.components.schemas)) {
            transformed.components.schemas[name] = transformSchema(schema);
        }
    }

    return transformed;
}

/**
 * Truncates a string to a maximum length, preferring to break at a separator for cleaner truncation.
 *
 * Used to ensure operation summaries fit within ChatGPT's 300 character limit while maintaining
 * readability by breaking at sentence boundaries when possible.
 *
 * @param str - The string to truncate (defaults to empty string)
 * @param maxLen - Maximum allowed length
 * @param separator - Preferred character to break at (defaults to '.')
 * @returns The truncated string, broken at the last separator before maxLen if found,
 *          otherwise truncated at maxLen
 *
 * @example
 * splitOnSeparator("First sentence. Second sentence. Third sentence.", 30, ".")
 * // Returns: "First sentence. Second sentence"
 */
function splitOnSeparator(str = '', maxLen: number, separator = ' .') {
    // Return as-is if already within limit
    if (str.length <= maxLen) {
        return str;
    }

    // Find the last occurrence of the separator before maxLen to break at a clean boundary
    const idx = str.lastIndexOf(separator, maxLen);

    // If separator not found, hard truncate at maxLen
    if (idx === -1) {
        return str.substring(0, maxLen);
    }

    // Truncate at the last separator for a clean break
    return str.substring(0, idx);
}
