import json from '@rollup/plugin-json';
import path from 'path';
import esbuild from 'rollup-plugin-esbuild';
import sourcemaps from 'rollup-plugin-sourcemaps';
import { typescriptPaths } from 'rollup-plugin-typescript-paths';
import { colorfulLogs, colors } from './scripts/rollup-colorfulLogs';
import { execSync } from 'child_process';
import copy from 'rollup-plugin-copy';
// Function to automatically mark all non-local imports as external
// avoids warning message about external dependencies
const isExternal = (id, ...overArgs) => {
    const _isExternal = !id.startsWith('.') && !path.isAbsolute(id);
    return _isExternal;
};

const config = {
    input: 'src/index.ts',
    output: {
        file: 'dist/index.js',
        format: 'es',
        sourcemap: true,
    },
    external: isExternal,
    plugins: [
        colorfulLogs('Smyth Builder'),
        ctixPlugin(), // Add ctix plugin as first plugin
        json(),
        typescriptPaths({
            tsconfig: './tsconfig.json',
            preserveExtensions: true,
            nonRelative: false,
        }),

        sourcemaps(),
        esbuild({
            sourceMap: true,
            minify: false,
            treeShaking: false,
            sourcesContent: true,
        }),
        copy({
            targets: [
                // Copy swagger JS assets to their role directory
                { src: 'src/roles/swagger/assets/*', dest: 'dist/roles/swagger/assets' },
                // Copy swagger-ui-dist package files
                { src: 'node_modules/swagger-ui-dist/*.{js,css,html,map}', dest: 'dist/swagger-ui-dist' },
            ],
        }),
    ],
};

export default config;

// Custom ctix plugin to generate barrel files
function ctixPlugin(options = {}) {
    return {
        name: 'ctix-barrel-generator',
        buildStart() {
            try {
                process.stdout.write(`\n${colors.cyan}⚙️ ${colors.yellow} Generating barrel files...${colors.reset}\n`);
                execSync('pnpm exec ctix build', { stdio: 'inherit' });
                console.log(`${colors.green}✅ ${colors.bright}Barrel files generated successfully!${colors.reset}\n`);
            } catch (error) {
                this.error(`Failed to generate ctix barrel files: ${error.message}`);
            }
        },
    };
}
