import { AgentSettings, ConnectorService, Logger } from '@smythos/sdk/core';

const console = Logger('AgentLoader.mw');

export default async function AgentLoader(req, res, next) {
    console.log('AgentLoader', req.path);
    const agentDataConnector = ConnectorService.getAgentDataConnector();

    let agentId = req.header('X-AGENT-ID');
    const agentVersion = req.header('X-AGENT-VERSION') || '';
    const debugHeader =
        req.header('X-DEBUG-STOP') !== undefined ||
        req.header('X-DEBUG-RUN') !== undefined ||
        req.header('X-DEBUG-INJ') !== undefined ||
        req.header('X-DEBUG-READ') !== undefined;

    let agentDomain: string = '';
    let isTestDomain = false;
    const { path, version: extractedVersion } = extractAgentVerionsAndPath(req.path);
    let version = extractedVersion ?? agentVersion;

    const domain = req.hostname;
    const method = req.method;
    if (!agentId) {
        agentId = await agentDataConnector.getAgentIdByDomain(domain).catch((error) => {
            console.error(error);
        });
        agentDomain = domain; //only override agentDomain if the agentId was loaded from domain
    }
    if (agentId && domain.includes(process.env.AGENT_DOMAIN)) {
        isTestDomain = true;
    }

    if (agentId) {
        if (!isTestDomain && agentId && req.hostname.includes('localhost')) {
            console.log(`Agent is running on localhost (${req.hostname}), assuming test domain`);
            isTestDomain = true;
        }
        if (agentDomain && !isTestDomain && !version && !debugHeader) {
            //when using a production domain but no version is specified, use latest
            version = 'latest';
        }
        const agentData = await agentDataConnector.getAgentData(agentId, version).catch((error) => {
            console.warn('Failed to load agent data', {
                agentId,
                version,
                errorMessage: error?.message,
            });
            return { error: error.message };
        });
        if (agentData?.error) {
            // return Not found error for storage requests
            if (req.path.startsWith('/storage/')) {
                return res.status(404).send(`File Not Found`);
            }
            return res.status(500).send({ error: agentData.error });
        }

        // clean up agent data
        cleanAgentData(agentData);

        req._plan = agentData.data.planInfo;
        req._agentData = agentData.data;
        req._agentData.planInfo = req._plan || {
            planId: undefined,
            planName: undefined,
            isFreePlan: true,
            tasksQuota: 0,
            usedTasks: 0,
            remainingTasks: 0,
            maxLatency: 100,
        };

        if (!isTestDomain && req._agentData.debugSessionEnabled && debugHeader) {
            console.log(`Host ${req.hostname} is using debug session. Assuming test domain.#2`);
            isTestDomain = true;
        }

        req._agentData.usingTestDomain = isTestDomain;
        req._agentData.domain = agentDomain || agentData?.data?.metadata?.domains?.[0]?.name || (await getAgentDomainById(agentId));
        req._agentVersion = version;
        req._agentData.version = version; //normally agentData.version stores the schema version, but for some backwards compatibility reasons, we override it with the actual agent version.
        const agentSettings = new AgentSettings(agentId);
        req._agentSettings = agentSettings;

        console.log(`Loaded Agent:${agentId} v=${version} path=${path} isTestDomain=${isTestDomain} domain=${agentDomain}`);
        return next();
    }

    console.warn('Not found', { path: req.path });
    return res.status(404).send({ error: `${req.path} Not Found` });
}
// clean up agent data
function cleanAgentData(agentData) {
    if (agentData) {
        // remove Note components
        if (agentData.data.components) {
            agentData.data.components = agentData.data.components?.filter((c) => c.name != 'Note');
        }

        // remove templateInfo
        delete agentData.data?.templateInfo;

        // TODO : remove UI attributes
    }
    return agentData;
}

export function extractAgentVerionsAndPath(url) {
    const regex = /^\/v(\d+(\.\d+)?)?(\/api\/.+)/;
    const match = url.match(regex);

    if (match) {
        return {
            path: match[3],
            version: match[1] || '',
        };
    } else {
        return {
            path: url,
            version: '',
        };
    }
}

export async function getAgentDomainById(agentId: string) {
    const agentDataConnector = ConnectorService.getAgentDataConnector();

    const deployed = await agentDataConnector.isDeployed(agentId);
    if (deployed) {
        return `${agentId}.${process.env.PROD_AGENT_DOMAIN}`;
    } else {
        return `${agentId}.${process.env.AGENT_DOMAIN}`;
    }
}
