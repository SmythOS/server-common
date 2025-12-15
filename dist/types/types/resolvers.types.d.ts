import type express from 'express';
import type { Resolvable } from '@/roles/Base.role';
/**
 * Common resolver types for role configuration.
 * These types define patterns for resolving dynamic values in role options.
 */
/**
 * Resolves AI model selection based on agent configuration.
 * Can be a static model name or a function that dynamically selects based on context.
 *
 * @example
 * -- Static model
 * const options = { model: 'gpt-4' };
 *
 * @example
 * -- Dynamic model selection
 * const options = {
 *     model: ({ baseModel, planInfo }) => {
 *         if (planInfo.tier === 'enterprise') return 'gpt-4-turbo';
 *         return baseModel;
 *     }
 * };
 */
export type ModelResolver = Resolvable<string, {
    baseModel: string;
    planInfo: Record<string, any>;
}>;
/**
 * Resolves server origin URL based on request context.
 * Can be a static URL or a function that dynamically determines the origin.
 *
 * @example
 * -- Static origin
 * const options = { serverOrigin: 'https://api.example.com' };
 *
 * @example
 * -- Dynamic origin based on request
 * const options = {
 *     serverOrigin: ({ req }) => {
 *         const host = req.get('host');
 *         return `https://${host}`;
 *     }
 * };
 */
export type ServerOriginResolver = Resolvable<string, {
    req: express.Request;
}>;
