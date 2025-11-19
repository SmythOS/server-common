import cors from 'cors';

import { Agent, AgentSettings, Logger } from '@smythos/sdk/core';
const console = Logger('CORS.mw');

async function getEmbodimentsAllowedOrigins(agentSettings: AgentSettings) {
    // wait for agent embodiments to be ready
    await agentSettings?.embodiments?.ready();

    const embSettings = agentSettings?.embodiments?.getAll() ?? {};
    const agentAllowedOrigins = Object.values(embSettings)
        .flatMap((embodiment: any) => embodiment.allowedDomains)
        .flat(Infinity)
        .map((domain: string) => {
            if (domain?.startsWith('http')) {
                return new URL(domain)?.origin;
            }
            return `https://${domain}`;
        });
    return agentAllowedOrigins;
}

function checkCors(req: any, allowedOrigins: string[], allowedDomains: string[]) {
    const origin = req.get('Origin'); //origin is the origin of the request

    if (!origin) return true;
    const host = req.get('Host'); //host is the host of the request
    const originDomain = new URL(origin).hostname;

    console.log('Cors check ', origin, '==>', host);

    //first check if the origin is the same as the host
    const isSameOrigin = origin === `http://${host}` || origin === `https://${host}`;
    if (isSameOrigin) return true;

    //then check if the origin is in the allowed origins
    if (allowedOrigins.includes(origin)) return true;

    //then check if the origin domain is in the allowed domains
    if (allowedDomains.includes(originDomain)) return true;

    if (req.method == 'OPTIONS') {
        console.log('CORS check ', { path: req.path, host, origin }, '==> Denied ');
        console.log('Allowed Domains for this request ', allowedOrigins, allowedDomains);
    }

    return false;
}

// Custom CORS middleware
//FIXME : make default CORS configurable from .env file
const corsOptionsDelegate = async (req, callback) => {
    const allowedEmbOrigins = await getEmbodimentsAllowedOrigins(req._agentSettings);
    const isAllowed = checkCors(req, allowedEmbOrigins, []);
    let corsOptions;
    if (isAllowed) {
        // Enable CORS for the same origin and the allowed domains
        corsOptions = {
            origin: true,
            credentials: true, // Allow credentials (cookies, etc.)
            methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed methods
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Conversation-Id', 'X-Auth-Token', 'X-Parent-Cookie'],
        };
    } else {
        // Disable CORS for other requests
        corsOptions = { origin: false };
    }

    callback(null, corsOptions);
};

const middleware = cors(corsOptionsDelegate);

export default middleware;
