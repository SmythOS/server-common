import { AccessCandidate, ConnectorService } from '@smythos/sdk/core';

/**
 * JSON Schema structure for tool parameters.
 * Represents the input schema format used for function/tool definitions.
 */
export interface ToolParameterSchema {
    type: 'object';
    properties?: Record<
        string,
        {
            type?: string | string[];
            description?: string;
            [key: string]: unknown;
        }
    >;
    required?: string[];
    [key: string]: unknown;
}

/**
 * Voice tool definition for voice embodiment.
 * Self-contained type that doesn't depend on external MCP SDK types.
 */
export interface VoiceTool {
    /**
     * Unique identifier for the tool.
     */
    name: string;
    /**
     * Human-readable description of what the tool does.
     */
    description?: string;
    /**
     * Parameters schema for OpenAI Realtime API compatibility.
     * Defines the input structure expected by this tool.
     */
    parameters: ToolParameterSchema;
    /**
     * Endpoint information for internal routing and API calls.
     */
    endpointInfo: {
        method: string;
        path: string;
        baseUrl: string;
    };
}

/**
 * OpenAPI operation parameter definition
 */
interface OpenAPIParameter {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    description?: string;
    schema?: {
        type?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * OpenAPI operation object structure
 */
interface OpenAPIOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    parameters?: OpenAPIParameter[];
    requestBody?: {
        content?: {
            'application/json'?: {
                schema?: {
                    properties?: Record<string, unknown>;
                    required?: string[];
                    [key: string]: unknown;
                };
                [key: string]: unknown;
            };
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * OpenAPI specification structure
 */
export interface OpenAPISpec {
    openapi: string;
    info: {
        title: string;
        description: string;
        version: string;
    };
    servers: Array<{ url: string }>;
    paths: Record<string, Record<string, OpenAPIOperation>>;
    components?: {
        schemas?: Record<string, unknown>;
        securitySchemes?: Record<string, unknown>;
    };
    security?: Array<Record<string, string[]>>;
    [key: string]: unknown; // Allow additional OpenAPI properties
}

export const createToolsFromOpenAPI = (openAPI: OpenAPISpec, baseUrl: string): VoiceTool[] => {
    const tools: VoiceTool[] = [];

    for (const [path, methods] of Object.entries(openAPI.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
            if (typeof operation !== 'object' || !operation) continue;

            const toolName = operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const description = operation.summary || operation.description || `${method.toUpperCase()} ${path}`;

            // Build parameters from path parameters, query parameters, and request body
            const parameters: ToolParameterSchema = {
                type: 'object',
                properties: {},
                required: [],
            };

            // Add path parameters
            if (operation.parameters) {
                for (const param of operation.parameters) {
                    if (param.in === 'path' || param.in === 'query') {
                        parameters.properties[param.name] = {
                            type: param.schema?.type || 'string',
                            description: param.description,
                        };
                        if (param.required) {
                            parameters.required.push(param.name);
                        }
                    }
                }
            }

            // Add request body parameters (for POST, PUT, PATCH)
            if (operation.requestBody?.content?.['application/json']?.schema) {
                const schema = operation.requestBody.content['application/json'].schema;
                if (schema.properties) {
                    Object.assign(parameters.properties, schema.properties);
                    if (schema.required) {
                        parameters.required.push(...schema.required);
                    }
                }
            }

            tools.push({
                name: toolName,
                description,
                parameters,
                endpointInfo: {
                    method: method.toUpperCase(),
                    path,
                    baseUrl,
                },
            });
        }
    }

    return tools;
};

export const createSpecInfoFromOpenAPI = (openAPI: OpenAPISpec) => {
    return {
        title: openAPI.info?.title || 'API Assistant',
        description: openAPI.info?.description || '',
    };
};

export const buildInstructions = ({ title, description, behavior }: { title: string; description: string; behavior: string }): string => {
    const baseInstructions = `Speak conversationally and naturally, as if talking to a friend. Use casual language, contractions, and natural speech patterns. Avoid overly formal or robotic language.

IMPORTANT: Before denying any user request, carefully examine all available tools and their capabilities. Many requests that might seem impossible can actually be accomplished using the available tools. Only deny requests if you're certain no available tool can help.

Use "I" and "me" when referring to yourself, and "we" when talking about the service's capabilities. Avoid technical terms like "API" or "service" - just speak naturally about what you can do.

IMPORTANT VOICE OPTIMIZATION: When speaking information, format it appropriately for voice:
- Phone numbers: Say each digit individually (e.g., "five-five-five, one-two-three, four-five-six-seven")
- Currency: Say the full amount naturally (e.g., "twenty-five dollars and fifty cents" not "25.50")
- Dates: Use natural format (e.g., "March fifteenth, twenty-twenty-four" not "03/15/2024")
- Times: Use conversational format (e.g., "quarter past three" or "three fifteen" not "15:15")
- Numbers: Use natural language for large numbers (e.g., "one thousand two hundred" not "1200")
- Email addresses: Spell out each character (e.g., "john dot smith at company dot com")
- URLs: Spell out each character or use "dot" and "slash" (e.g., "w w w dot example dot com slash page")
- Addresses: Use natural format with street names spelled out
- File sizes: Use conversational units (e.g., "two and a half megabytes" not "2.5MB")
- Percentages: Say naturally (e.g., "seventy-five percent" not "75%")
- Temperatures: Include units naturally (e.g., "seventy-two degrees Fahrenheit")
- Measurements: Use conversational units (e.g., "five feet ten inches" not "5'10"")

Your operating over an audio channel so following these instructions is critical:
Keep responses conversational and concise. Break down the information into digestible pieces.
When using tools, briefly acknowledge what you're doing: "Let me check that for you..." or "I'll look that up..." Then, when you get the results, summarize the key information in a conversational way rather than reading data verbatim. Focus on what's most relevant to the user's question.
`;
    if (title && description) {
        return `IMPORTANT: When you first connect, introduce yourself ${behavior ? `using the following behavior: "${behavior}"` : 'naturally.'} 
        
        Use the following information (not verbatim) for your identity and introduction: ${title} ${description ? `optional information about the service: "${description}"` : ''} 
        ${baseInstructions}`;
    } else {
        return `You are a friendly and knowledgeable voice assistant. Speak naturally and conversationally, as if talking to a friend. 
        ${behavior ? `Use the following behavior: "${behavior}"` : ''} ${baseInstructions} Start by briefly introducing yourself.`;
    }
};

export const getVoiceConfig = (tools: VoiceTool[]) => {
    return {
        type: 'session.update',
        session: {
            type: 'realtime',
            audio: {
                input: {
                    turn_detection: {
                        type: 'server_vad',
                        threshold: 0.5,
                        prefix_padding_ms: 300,
                        silence_duration_ms: 500,
                    },
                },
            },
            tools: tools.map((tool) => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            })),
        },
    };
};

export const getAPIKeyFromVault = async (agentId: string, keyName: string): Promise<string | null> => {
    try {
        const accessCandidate = AccessCandidate.agent(agentId);
        const vaultConnector = ConnectorService.getVaultConnector();

        const apiKey = await vaultConnector
            .user(accessCandidate)
            .get(keyName)
            .catch((error) => {
                console.error('Error retrieving API key from vault:', error);
                return null;
            });

        return apiKey;
    } catch (error) {
        console.error('Failed to get API key:', error);
        return null;
    }
};

/**
 * Generates the CSS styles for the error UI
 */
export function getErrorStyles(): string {
    return `
        .error-container {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 40px;
            overflow-y: auto;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        }
        .error-content {
            max-width: 800px;
            margin: 0 auto;
            padding: 30px;
            background: #1a1a1a;
            border-radius: 8px;
            border: 1px solid #333;
        }
        .error-title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 20px;
            color: #ff6b6b;
        }
        .error-message {
            font-size: 16px;
            line-height: 1.8;
            margin-bottom: 25px;
        }
        .error-steps {
            background: #2a2a2a;
            padding: 25px;
            border-radius: 6px;
            margin: 25px 0;
        }
        .error-steps ol {
            margin: 0;
            padding-left: 20px;
        }
        .error-steps li {
            margin: 12px 0;
            line-height: 1.8;
        }
        .error-steps p {
            line-height: 1.8;
        }
        .error-code {
            background: #000;
            padding: 15px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            margin: 15px 0;
            word-break: break-all;
            border: 1px solid #333;
        }
        .error-note {
            margin-top: 25px;
            padding: 20px;
            background: #2a2a2a;
            border-left: 4px solid #4dabf7;
            border-radius: 4px;
            line-height: 1.8;
        }
    `;
}

/**
 * Generates the error UI HTML with instructions for enabling microphone access
 */
export function getErrorUI(urlToDisplay: string): string {
    return `
    <div id="error-container" class="error-container">
        <div class="error-content">
            <div class="error-title">⚠️ Microphone Access Error</div>
            <div class="error-message">
                Voice embodiment requires microphone access, which is only available on secure (HTTPS) connections. 
                You are currently accessing this page over an insecure (HTTP) connection.
            </div>
            <div class="error-steps">
                <strong>To enable microphone access on HTTP (for development/testing):</strong>
                <p style="margin-bottom: 20px;">Different browsers have different ways to allow microphone access on insecure origins. Below is an example for Google Chrome. For other browsers, please search for "allow microphone on HTTP" or "insecure origin microphone" in your browser's settings or documentation.</p>
                <p style="margin-bottom: 20px;"><strong>Example: Google Chrome</strong></p>
                <ol>
                    <li>Open Google Chrome</li>
                    <li>Navigate to <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code></li>
                    <li>Enable the flag "Insecure origins treated as secure"</li>
                    <li>Add the following URL to the list:</li>
                </ol>
                <div class="error-code">${urlToDisplay}</div>
                <ol start="5">
                    <li>Click "Relaunch" to restart Chrome</li>
                    <li>Refresh this page</li>
                </ol>
            </div>
            <div class="error-note">
                <strong>Note:</strong> This workaround is only for development/testing. In production, always use HTTPS for voice embodiment features. If you're using a different browser, search for browser-specific instructions to allow microphone access on HTTP connections.
            </div>
        </div>
    </div>
    `;
}

/**
 * Generates the JavaScript script to initialize VoiceEmbodiment with error handling
 */
export function getVoiceEmbodimentInitScript(isSecure: boolean, domain: string, queryType: string): string {
    return `
        (function() {
            // Check if we're on an insecure connection
            const isSecure = ${isSecure ? 'true' : 'false'};
            const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
            
            // Check for getUserMedia availability
            if (!hasGetUserMedia) {
                // Check if it's because we're on HTTP
                if (!isSecure && window.location.protocol === 'http:') {
                    document.getElementById('error-container').style.display = 'block';
                    return;
                }
            }
            
            // Try to initialize VoiceEmbodiment with error handling
            try {
                if (typeof VoiceEmbodiment !== 'undefined') {
                    VoiceEmbodiment.init({
                        domain:'${domain}?type=${queryType}',
                    });
                } else {
                    throw new Error('VoiceEmbodiment is not defined');
                }
            } catch (error) {
                // Check if error is related to getUserMedia
                const errorMessage = error?.message || String(error);
                if (errorMessage.includes('getUserMedia') || errorMessage.includes('mediaDevices')) {
                    if (!isSecure && window.location.protocol === 'http:') {
                        document.getElementById('error-container').style.display = 'block';
                    } else {
                        console.error('Voice embodiment initialization error:', error);
                        document.getElementById('error-container').querySelector('.error-message').textContent = 
                            'Failed to initialize voice embodiment: ' + errorMessage;
                        document.getElementById('error-container').style.display = 'block';
                    }
                } else {
                    console.error('Voice embodiment initialization error:', error);
                }
            }
        })();
    `;
}
