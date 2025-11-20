const PROD_VERSION_VALUES = ['prod', 'production', 'stable'];
const TEST_VERSION_VALUES = ['dev', 'develop', 'development', 'test', 'staging'];

export function getAgentIdAndVersion(model: string) {
    const [agentId, version] = model.split('@');
    let agentVersion = version?.trim() || undefined;
    if (TEST_VERSION_VALUES.includes(agentVersion)) {
        agentVersion = '';
    }
    if (PROD_VERSION_VALUES.includes(agentVersion)) {
        agentVersion = 'latest';
    }

    return { agentId, agentVersion };
}
