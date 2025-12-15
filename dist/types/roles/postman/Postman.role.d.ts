import express from 'express';
import { BaseRole } from '@/roles/Base.role';
export declare class PostmanRole extends BaseRole {
    /**
     * Creates a new PostmanRole instance.
     * @param middlewares - Custom middlewares to apply to the role on top of the default middlewares.
     * @param options - Configuration options for the role.
     * @param options.serverOrigin - The server origin URL. Can be a string or a function that accepts the request and returns a string.
     *                                Used to generate the correct base URL in the OpenAPI spec before conversion.
     *                                Defaults to an empty string.
     */
    constructor(middlewares: express.RequestHandler[], options: {
        serverOrigin: string | ((req: express.Request) => string);
    });
    /**
     * Mounts the Postman collection endpoint on the provided router.
     *
     * Creates a GET route that:
     * 1. Loads agent data via AgentLoader middleware
     * 2. Fetches the agent's OpenAPI specification
     * 3. Converts the OpenAPI spec to Postman collection format using openapi-to-postmanv2
     * 4. Returns the Postman collection as a downloadable JSON file
     *
     * @param router - The Express router to mount the endpoint on.
     * @throws Returns 500 error if OpenAPI spec retrieval or conversion fails.
     */
    mount(router: express.Router): Promise<void>;
}
