export default function AgentLoader(req: any, res: any, next: any): Promise<any>;
export declare function extractAgentVerionsAndPath(url: any): {
    path: any;
    version: any;
};
export declare function getAgentDomainById(agentId: string): Promise<string>;
