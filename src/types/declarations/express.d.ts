import { AgentSettings } from '@smythos/sdk/core';

declare global {
    namespace Express {
        interface Request {
            _agentData?: any;
            _agentVersion?: string;
            _agentSettings?: AgentSettings;
            _plan?: any;
            _chatbot?: ChatService;
            sessionID?: string;
            files?: multer.File[];
            _agentAuthData?: any;
            _isSessionAuthorized?: boolean;
            agentUrl?: string;
        }
    }
}

export {};
