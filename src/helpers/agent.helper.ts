import { AccessCandidate, ConnectorService } from '@smythos/sdk/core';

// Constants for agent auth data
const AGENT_AUTH_SETTINGS_KEY = 'agent-auth-data';

/**
 * Gets agent authentication data with caching support
 * @param agentId - The ID of the agent
 * @returns Promise containing the agent auth settings
 */
export async function getAgentAuthData(agentId: string) {
    const accountConnector = ConnectorService.getAccountConnector();

    const settings = await accountConnector.user(AccessCandidate.agent(agentId)).getAgentSetting(AGENT_AUTH_SETTINGS_KEY);

    return JSON.parse(settings || '{}');
}
