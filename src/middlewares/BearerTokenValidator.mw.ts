import { getAgentToken } from '@/helpers/auth.helper';
import { AuthRouteOptions, ProviderInfo } from '@/types/auth.types';

/**
 * Middleware to validate bearer token
 * @param providerInfo - Provider information
 * @param bypass - Set it to true if you want to continue even if the token is not valid
 * @returns Express middleware function
 */

export default async function BearerTokenValidatorMW(providerInfo: ProviderInfo, { bypass, checkHeaderForAuthToken }: AuthRouteOptions) {
    return async (req, res, next) => {
        const agentData = (req as any)._agentData;
        const agentId = agentData.id;

        let token = getAgentToken(req, agentId);

        if (checkHeaderForAuthToken && req.headers['authorization']) {
            token = req.headers['authorization']?.split(' ')[1] || '';
        }

        if (!token) {
            if (bypass) {
                return next();
            } else {
                return res.status(401).json({ error: 'Unauthorized: Access token is required' });
            }
        }

        if (token != providerInfo?.token) {
            if (bypass) {
                return next();
            } else {
                return res.status(401).json({ error: 'Unauthorized: Invalid access token' });
            }
        }

        req._isSessionAuthorized = true;

        return next();
    };
}
