/**
 * Rollup external dependencies configuration utility
 *
 * Provides functions to determine which packages should be marked as external
 * in Rollup builds to avoid bundling heavy dependencies.
 */

/**
 * List of heavy packages that should be marked as external.
 * These packages are available at runtime from node_modules and should not be bundled
 * to prevent memory issues during build and reduce bundle size.
 */
const HEAVY_PACKAGES = ['openapi-to-postmanv2', 'swagger-ui-express', 'swagger-ui-dist'];

/**
 * Creates an isExternal function for Rollup that marks heavy packages as external.
 *
 * @param {string[]} additionalPackages - Optional array of additional package names to mark as external
 * @returns {function(string): boolean} Function that returns true if a package should be external
 *
 * @example
 * // In rollup.config.js:
 * import { isExternal } from '@smythos/server-common/scripts/rollup-external';
 *
 * export default {
 *   external: isExternal(),
 *   // ... rest of config
 * };
 */
export function isExternal(additionalPackages = []) {
    const allHeavyPackages = [...HEAVY_PACKAGES, ...additionalPackages];

    return (id) => {
        // Check if the import matches any heavy package
        for (const pkg of allHeavyPackages) {
            if (id === pkg || id.startsWith(`${pkg}/`)) {
                return true;
            }
        }
        return false;
    };
}

/**
 * Default isExternal function that marks heavy packages as external.
 * This is a convenience export for direct use.
 */
export const isHeavyPackageExternal = isExternal();
