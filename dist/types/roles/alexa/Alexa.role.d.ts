import express from 'express';
import { BaseRole } from '@/roles/Base.role';
import type { ModelResolver, ServerOriginResolver } from '@/types/resolvers.types';
export declare class AlexaRole extends BaseRole {
    /**
     * Creates a new AlexaRole instance.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role
     * @param options.serverOrigin - Server origin URL: string for static, or function to resolve dynamically from request
     * @param options.model - Optional model override: string for static model, or function to resolve model dynamically
     */
    constructor(middlewares: express.RequestHandler[], options: {
        serverOrigin: ServerOriginResolver;
        model?: ModelResolver;
    });
    mount(router: express.Router): Promise<void>;
}
