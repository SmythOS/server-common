import { AgentSettings } from '@smythos/sdk/core';

declare global {
    namespace Express {
        interface Request {
            _agentData?: any;
            _agentVersion?: string;
            _agentSettings?: AgentSettings;
            _plan?: any;
        }
    }
}

export {};
