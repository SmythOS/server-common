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

export class BaseRole {
    /**
     * Creates a new Role instance.
     * @param router - The router to mount the role on.
     * @param middlewares - The custom middlewares to apply to the role on top of the default middlewares.
     */
    constructor(
        protected middlewares: express.RequestHandler[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        protected options?: Record<string, any>,
    ) {}

    /**
     * Resolves a value that can be either static or dynamically computed via a function.
     * This generic method implements the DRY principle for value-or-function resolution patterns.
     *
     * @template T - The type of the resolved value
     * @template Args - The argument object type for the resolver function
     *
     * @param resolvable - Either a static value of type T or a function that returns T
     * @param options - Configuration object
     * @param options.args - Argument object to pass to the resolver function (if resolvable is a function)
     * @param options.defaultValue - Optional default value to use if resolvable is undefined or returns undefined
     * @returns The resolved value of type T, or defaultValue, or undefined
     *
     * @example
     * -- Resolve server origin without default (returns string | undefined)
     * const origin = this.resolve(this.options.serverOrigin, { args: { req } });
     *
     * @example
     * -- Resolve model with default fallback (always returns string)
     * const model = this.resolve(this.options.model, {
     *     args: { baseModel, planInfo: agentData?.planInfo || {} },
     *     defaultValue: baseModel
     * });
     */
    protected resolve<T, Args = void>(
        resolvable: Resolvable<T, Args> | undefined,
        options: { args: Args; defaultValue?: T },
    ): T | undefined {
        if (resolvable === undefined) {
            return options.defaultValue;
        }
        const resolved = typeof resolvable === 'function' ? (resolvable as (args: Args) => T)(options.args) : resolvable;
        return resolved !== undefined ? resolved : options.defaultValue;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async mount(router: express.Router) {}
}
