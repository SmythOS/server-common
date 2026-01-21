import axios from 'axios';
import { AccessCandidate, ConnectorService } from '@smythos/sdk/core';

const AGENT_AUTH_SETTINGS_KEY = 'agent-auth-data';

/**
 * OAuth provider configuration
 */
interface OAuthProvider {
    OIDCConfigURL: string;
    clientID: string;
    clientSecret: string;
}

/**
 * Agent authentication data structure
 */
interface AgentAuthData {
    method?: string;
    provider?: Record<string, OAuthProvider>;
}

/**
 * Gets agent authentication data with caching support
 * @param agentId - The ID of the agent
 * @returns Promise resolving to an object containing the agent auth settings, or an empty object if no settings exist
 */
export async function getAgentAuthData(agentId: string): Promise<AgentAuthData> {
    const accountConnector = ConnectorService.getAccountConnector();

    const freshSettings = await accountConnector.user(AccessCandidate.agent(agentId)).getAgentSetting(AGENT_AUTH_SETTINGS_KEY);

    return JSON.parse(freshSettings || '{}');
}

/**
 * Reads and retrieves OAuth configuration for an agent
 * Fetches the OIDC configuration from the provider's discovery endpoint and extracts OAuth settings
 * @param agentId - The ID of the agent
 * @returns Promise resolving to an object containing OAuth configuration including authorizationURL, tokenURL, clientID, clientSecret, method, and provider, or an empty object if no provider is configured
 */
export async function readAgentOAuthConfig(agentId: string): Promise<{
    authorizationURL?: string;
    tokenURL?: string;
    clientID?: string;
    clientSecret?: string;
    method?: string;
    provider?: OAuthProvider;
}> {
    const authInfo = await getAgentAuthData(agentId);
    const method = authInfo?.method;
    const provider = method ? authInfo?.provider?.[method] : undefined;
    if (!provider) return {};
    const authOIDCConfigURL = provider.OIDCConfigURL;
    const clientID = provider.clientID;
    const clientSecret = provider.clientSecret;
    const openid: { data?: { token_endpoint?: string; authorization_endpoint?: string }; error?: unknown } = await axios.get(authOIDCConfigURL).catch((error) => ({ error }));

    const tokenURL = openid?.data?.token_endpoint;
    const authorizationURL = openid?.data?.authorization_endpoint;

    return { authorizationURL, tokenURL, clientID, clientSecret, method, provider };
}