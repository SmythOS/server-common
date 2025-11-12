import { TEmbodimentType } from '../types';
import { Request, Response, NextFunction } from 'express';

export default async function EmbodimentAccessCheck(req: Request, res: Response, next: NextFunction) {
    const agentSettings = (req as any)._agentSettings;
    const agentData = (req as any)._agentData;
    if (!agentData) {
        return res.status(404).send({ error: 'Agent not found' });
    }

    try {
        // Wait for agent settings to be ready
        await agentSettings?.ready();

        // Determine which embodiment is being accessed
        const path = req.originalUrl || req.url || req.path;
        const embodimentType = getEmbodimentTypeFromUrl(path);

        // Determine if the embodiment is enabled
        const hasEmbodimentAccess = agentData.usingTestDomain
            ? true
            : (() => {
                  const settingsValue = agentSettings?.get(embodimentType?.toLowerCase());
                  if (!settingsValue) return false;

                  const parsedSettings = JSON.parse(settingsValue);

                  return typeof parsedSettings === 'boolean' ? parsedSettings : parsedSettings.isEnabled;
              })();

        if (!hasEmbodimentAccess) {
            return res.status(403).send({
                error: 'This embodiment feature is currently disabled for your agent. Please enable it in your agent settings to continue.',
            });
        }
        next();
    } catch (error) {
        console.error('[EmbodimentAccessCheck:error]', error);
        return res.status(424).send({
            error: 'Failed to load agent settings. Please try again in a moment.',
        });
    }
}

/**
 * Determines the embodiment type based on the request URL/path
 * @param url - The request URL, path, or originalUrl
 * @returns The embodiment type or null if not found
 */
export function getEmbodimentTypeFromUrl(url: string): string | null {
    if (!url) return null;

    // Normalize the URL to handle both /emb/... and direct paths
    const normalizedUrl = url.toLowerCase();

    switch (true) {
        case ['/voice', '/emb/voice'].some((pattern) => normalizedUrl.includes(pattern)):
            return TEmbodimentType.Alexa; // Voice uses alexa setting
        case ['/alexa', '/emb/alexa'].some((pattern) => normalizedUrl.includes(pattern)):
            return TEmbodimentType.Alexa;
        case ['/chatbot', '/emb/chat'].some((pattern) => normalizedUrl.includes(pattern)):
            return TEmbodimentType.ChatBot;
        case ['/form-preview', '/emb/form-preview'].some((pattern) => normalizedUrl.includes(pattern)):
            return TEmbodimentType.FormPreview;
        case ['/emb/chatgpt'].some((pattern) => normalizedUrl.includes(pattern)):
            return TEmbodimentType.ChatGPT;
        case ['/mcp', '/emb/mcp'].some((pattern) => normalizedUrl.includes(pattern)):
            return TEmbodimentType.MCP;
        case ['/_openai', '/emb/openai'].some((pattern) => normalizedUrl.includes(pattern)):
            return TEmbodimentType.LLM;

        default:
            return null;
    }
}
