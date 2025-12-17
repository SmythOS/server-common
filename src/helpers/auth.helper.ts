import { Request } from 'express';

/**
 * Get the authorization token for an agent
 * Returns the token from local storage (for local agents) or session storage
 */
export function getAgentToken(req: Request, agentId: string): string | null {
    const isLocalAgent = req.hostname?.includes('localagent');

    if (isLocalAgent) {
        return localAgentAuthorizations?.[agentId]?.verifiedKey || null;
    }

    return req.session?.agentAuthorizations?.[agentId]?.verifiedKey || null;
}

/**
 * Centralized storage for local agent authorizations (in-memory)
 * Used for local development environments
 */
const localAgentAuthorizations: Record<string, { verifiedKey: string; authMethod: string }> = {};

/**
 * Clear authorization for an agent
 * Clears both local and session storage
 */
export function clearAgentAuthorization(req: Request, agentId: string): void {
    // Clear local storage
    if (localAgentAuthorizations?.[agentId]) {
        delete localAgentAuthorizations[agentId];
    }

    // Clear session storage
    if (req.session?.agentAuthorizations?.[agentId]) {
        delete req.session.agentAuthorizations[agentId];
        req.session.save();
    }
}
