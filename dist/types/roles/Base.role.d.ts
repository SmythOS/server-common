import express from 'express';
/**
 * Generic type for values that can be either static or dynamically resolved via a function.
 * @template T - The type of the resolved value
 * @template Args - The argument object type for the resolver function
 *
 * @example
 * type ModelResolver = Resolvable<string, { baseModel: string; planInfo: Record<string, any> }>;
 * type ServerOriginResolver = Resolvable<string, { req: express.Request }>;
 */
export type Resolvable<T, Args = void> = T | ((args: Args) => T);
export declare class BaseRole {
    protected middlewares: express.RequestHandler[];
    protected options?: Record<string, any>;
    /**
     * Creates a new Role instance.
     * @param router - The router to mount the role on.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     */
    constructor(middlewares: express.RequestHandler[], options?: Record<string, any>);
    /**
     * Resolves a value that can be either static or dynamically computed via a function.
     * This generic method implements the DRY principle for value-or-function resolution patterns.
     *
     * @template T - The type of the resolved value
     * @template Args - The argument object type for the resolver function
     *
     * @param resolvable - Either a static value of type T or a function that returns T
     * @param args - Optional argument object to pass to the resolver function (required only if resolvable is a function)
     * @param defaultValue - Optional default value to use if resolvable is undefined or returns undefined
     * @returns The resolved value of type T, or defaultValue, or undefined
     *
     * @example
     * -- Resolve static value with default
     * const timeout = this.resolve(this.options.timeout, undefined, 5000);
     *
     * @example
     * -- Resolve dynamic value without default (returns string | undefined)
     * const origin = this.resolve(this.options.serverOrigin, req);
     *
     * @example
     * -- Resolve model with default fallback (always returns string)
     * const model = this.resolve(
     *     this.options.model,
     *     { baseModel, planInfo: agentData?.planInfo || {} },
     *     baseModel
     * );
     */
    protected resolve<T, Args = void>(resolvable: Resolvable<T, Args> | undefined, args?: Args, defaultValue?: T): T | undefined;
    mount(router: express.Router): Promise<void>;
}
