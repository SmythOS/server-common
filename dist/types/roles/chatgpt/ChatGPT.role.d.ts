import express from 'express';
import { BaseRole } from '@/roles/Base.role';
export declare class ChatGPTRole extends BaseRole {
    /**
     * Creates a new ChatGPTRole instance.
     *
     * This role provides ChatGPT-compatible OpenAPI specifications for SmythOS agents.
     * It transforms the standard OpenAPI 3.0.1 spec to 3.1.0 format required by ChatGPT Actions,
     * and handles GPT-specific limitations (e.g., 300 character summary limits).
     *
     * @param middlewares - Custom middlewares to apply on top of default middlewares
     * @param options - Configuration options for the role
     * @param options.serverOrigin - Server origin URL (string or function that returns string from request)
     *                                Used for generating absolute URLs in the OpenAPI spec
     */
    constructor(middlewares: express.RequestHandler[], options: {
        serverOrigin: string | ((req: express.Request) => string);
    });
    /**
     * Mounts the ChatGPT role routes on the provided router.
     *
     * Registers a GET endpoint at `/api-docs/openapi-gpt.json` that serves
     * a ChatGPT-compatible OpenAPI 3.1.0 specification for the agent.
     *
     * @param router - Express router to mount the routes on
     */
    mount(router: express.Router): Promise<void>;
}
