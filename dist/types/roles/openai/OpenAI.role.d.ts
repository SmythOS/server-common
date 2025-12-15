import express from 'express';
import { BaseRole } from '@/roles/Base.role';
import type { ModelResolver } from '@/types/resolvers.types';
export declare class OpenAIRole extends BaseRole {
    /**
     * Creates a new OpenAIRole instance.
     * @param middlewares - Additional middlewares to apply after AgentDataAdapter and AgentLoader
     * @param options - Configuration options for the role
     * @param options.model - Optional model override: string for static model, or function to resolve model dynamically
     */
    constructor(middlewares?: express.RequestHandler[], options?: {
        model?: ModelResolver;
    });
    mount(router: express.Router): Promise<void>;
}
