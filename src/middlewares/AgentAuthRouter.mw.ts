import { AuthRouteOptions, ProviderInfo } from '@/types/auth.types';

export default function AgentAuthRouter(
    providers: { [key: string]: (providerInfo: ProviderInfo, options?: AuthRouteOptions) => Promise<any> },
    options: AuthRouteOptions = { responseType: 'json', bypass: false },
) {
    return async (req, res, next) => {
        const agentAuthData = (req as any)._agentAuthData;

        if (agentAuthData?.method && agentAuthData?.method != 'none') {
            const method = agentAuthData?.method;
            const providerMW = providers[method];
            const providerInfo = agentAuthData?.provider?.[method];

            const middleware = await providerMW(providerInfo, options);

            return middleware(req, res, next);
        }

        next();
    };
}
