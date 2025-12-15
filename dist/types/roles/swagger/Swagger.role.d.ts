import express from 'express';
import { BaseRole } from '@/roles/Base.role';
export declare class SwaggerRole extends BaseRole {
    /**
     * Creates a new SwaggerRole instance.
     * @param router - The router to mount the role on.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     * @param options - The options for the role.
     * Accepts:
     * - staticPath: The path to the static files for the role. this assumes that a static route is mounted and the swagger files (swagger.js, swagger-debug.js) are served from this path.
     * Defaults to '/static/embodiment/swagger'.
     */
    constructor(middlewares: express.RequestHandler[], options: {
        serverOrigin: string | ((req: express.Request) => string);
        staticPath?: string;
    });
    mount(router: express.Router): Promise<void>;
}
