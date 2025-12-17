import { getAgentAuthData } from '@/helpers/agent.helper';
import { clearAgentAuthorization } from '@/helpers/auth.helper';
import { ProviderInfo } from '@/types/auth.types';

export default async function AgentAuthLoader(req, res, next) {
    const agentData = (req as any)._agentData;
    if (!agentData) {
        return res.status(404).send({ error: 'Agent not found' });
    }

    let deleteSessionAuth = false;

    if (agentData?.auth?.method && agentData?.auth?.method != 'none') {
        // #region Get auth data from settings
        const authFromSettings = await getAgentAuthData(agentData.id);
        const legacyAuthData = agentData?.auth || {};
        const authData = authFromSettings?.provider ? authFromSettings : legacyAuthData;
        // #endregion

        const providerInfo: ProviderInfo = authData?.provider?.[authData?.method];

        if (!authData?.method) {
            deleteSessionAuth = true;
        }

        if (authData?.method === 'oauth-oidc') {
            if (!providerInfo || !providerInfo.clientID || !providerInfo.clientSecret) {
                return res.status(401).send({ error: 'OIDC Auth provider not configured' });
            }
        } else if (authData?.method === 'api-key-bearer') {
            if (!providerInfo || !providerInfo?.token) {
                return res.status(401).send({ error: 'API Key Bearer not configured' });
            }
        }

        req._agentAuthData = authData;
    }

    if ((deleteSessionAuth || agentData?.auth?.method === 'none') && agentData?.id) {
        clearAgentAuthorization(req, agentData.id);
    }

    next();
}
