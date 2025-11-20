import { getAgentIdAndVersion } from '@/utils/agent.utils';

export default async function AgentDataAdapter(req, res, next) {
    const agentFromModel: any = req.body.model ? getAgentIdAndVersion(req.body.model) : {};

    //populate agent id and version headers if not present and LLM data provided
    req.headers['x-agent-id'] = req.header('x-agent-id') || agentFromModel.agentId;
    req.headers['x-agent-version'] = req.header('x-agent-version') || agentFromModel.version || '';

    next();
}
