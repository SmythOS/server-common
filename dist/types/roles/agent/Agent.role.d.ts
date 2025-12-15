import express from 'express';
export declare class AgentRole {
    private middlewares;
    private maxFileSize;
    private maxFileCount;
    private enableDebugger;
    private enableTriggers;
    private enableMonitor;
    constructor(middlewares: express.RequestHandler[], options: {
        maxUploadSize?: number;
        maxUploadsCount?: number;
        enableDebugger?: boolean;
        enableMonitor?: boolean;
        enableTriggers?: boolean;
    });
    mount(router: express.Router): Promise<void>;
}
