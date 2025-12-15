import express from 'express';
import { BaseRole } from '@/roles/Base.role';
export declare class MCPRole extends BaseRole {
    /**
     * Creates a new MCPRole instance.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role. Defaults to an empty object.
     */
    constructor(middlewares?: express.RequestHandler[], options?: Record<string, unknown>);
    mount(router: express.Router): Promise<void>;
}
