import AgentLoader from '@/middlewares/AgentLoader.mw';
import uploadHandlerFactory from '@/middlewares/UploadHandlerFactory.mw';
import cors from '@/middlewares/CORS.mw';
import RemoveHeadersFactory from '@/middlewares/RemoveHeadersFactory.mw';
import { Logger } from '@smythos/sdk/core';
import express from 'express';

import { createSseConnection, getDebugSession, processAgentRequest } from './AgentRequestHandler';
const console = Logger('AgentRole');

export class AgentRole {
    private maxFileSize: number;
    private maxFileCount: number;
    private enableDebugger: boolean;
    private enableTriggers: boolean;
    private enableMonitor: boolean;
    constructor(
        private middlewares: express.RequestHandler[],
        options: {
            maxUploadSize?: number;
            maxUploadsCount?: number;
            enableDebugger?: boolean;
            enableMonitor?: boolean;
            enableTriggers?: boolean;
        },
    ) {
        this.maxFileSize = options.maxUploadSize || 1024 * 1024 * 10; // 10MB
        this.maxFileCount = options.maxUploadsCount || 5;
        this.enableDebugger = options.enableDebugger || false;
        this.enableMonitor = options.enableMonitor || false;
        this.enableTriggers = options.enableTriggers || false;
    }
    public async mount(router: express.Router) {
        const uploadHandler = uploadHandlerFactory(this.maxFileSize, this.maxFileCount);
        const middlewares = [cors, uploadHandler, AgentLoader, ...this.middlewares];
        if (!this.enableDebugger) {
            const removeDebugHeaders = RemoveHeadersFactory(['x-debug-skip', 'x-debug-run', 'x-debug-inj', 'x-debug-read']);
            middlewares.unshift(removeDebugHeaders);
        }
        if (!this.enableMonitor) {
            const removeMonitorHeaders = RemoveHeadersFactory(['x-monitor-id']);
            middlewares.unshift(removeMonitorHeaders);
        }

        router.options('*', [cors]); //enable CORS for preflight requests

        if (this.enableDebugger) {
            router.get('/agent/:id/debugSession', [cors], (req, res, next) => {
                console.log(
                    `Getting debug session for agent ${req.params.id} with client IP ${req.headers['x-forwarded-for']} - ${req.socket.remoteAddress}. x-hash-id ${req.headers['x-hash-id']}`,
                );
                const dbgSession = getDebugSession(req.params.id);
                res.send({ dbgSession });
            });
        }

        if (this.enableMonitor) {
            router.get('/agent/:id/monitor', [cors], (req, res, next) => {
                const sseId = createSseConnection(req);

                // Set headers for SSE
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                // Send the unique ID as the first event
                res.write(`event: init\n`);
                res.write(`data: ${sseId}\n\n`);
            });
        }

        const reqHandler = async (req, res) => {
            try {
                const agentData: any = req._agentData;
                if (!agentData) {
                    res.status(404).json({ error: 'Agent not found' });
                    return;
                }
                const result: any = await processAgentRequest(req);
                if (!res.headersSent) {
                    res.status(result?.status || 500).send(result?.data);
                }
            } catch (error) {
                res.status(500).json({ error: error.message || 'Internal server error' });
            }
        };

        if (this.enableTriggers) {
            router.post(`/trigger/:name`, middlewares, reqHandler);
            router.get(`/trigger/:name`, middlewares, reqHandler);
        }

        router.post(`/api/*`, middlewares, reqHandler);
        router.get(`/api/*`, middlewares, reqHandler);

        router.post(`/:version/api/*`, middlewares, reqHandler);
        router.get(`/:version/api/*`, middlewares, reqHandler);

        router.post(/^\/v[0-9]+(\.[0-9]+)?\/api\/(.+)/, middlewares, reqHandler);
        router.get(/^\/v[0-9]+(\.[0-9]+)?\/api\/(.+)/, middlewares, reqHandler);
    }
}
