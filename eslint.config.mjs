import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
    {
        ignores: ['dist/**', 'build/**', 'node_modules/**'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettierConfig,
    {
        files: ['**/*.ts'],
        plugins: {
            import: importPlugin,
        },
        rules: {
            // Import ordering is handled by Prettier plugin
            'import/order': 'off',
            'import/no-unresolved': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
        },
        settings: {
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                },
            },
        },
    },
);

