import express from 'express';
import { SRE } from '@smythos/sdk/core';
export class BaseRole {
    /**
     * Creates a new Role instance.
     * @param router - The router to mount the role on.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     */
    constructor(
        protected middlewares: express.RequestHandler[],
        protected options?: Record<string, any>,
    ) {}

    public async mount(router: express.Router) {}
}
