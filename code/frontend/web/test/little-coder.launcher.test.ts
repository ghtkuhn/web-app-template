import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LittleCoderLauncher } from '../../../../script/little-coder/little-coder.launcher.ts';

describe('Little Coder launcher', () => {
    test('loads the project guard and forwards session arguments', () => {
        const projectRoot = path.resolve('/project');
        const launch = new LittleCoderLauncher(projectRoot).createLaunch(
            ['--session', 'auth-work'],
            {},
        );

        expect(launch.command).toBe('little-coder');
        expect(launch.arguments).toEqual([
            '--extension',
            path.join(
                projectRoot,
                'little-coder/extensions/backend-base-guard/index.ts',
            ),
            '--extension',
            path.join(
                projectRoot,
                'little-coder/extensions/backend-lint-gate/index.ts',
            ),
            '--session',
            'auth-work',
        ]);
    });

    test('removes inherited npm session configuration only', () => {
        const launch = new LittleCoderLauncher('/project').createLaunch(
            [],
            {
                npm_config_session: 'auth-work',
                NPM_CONFIG_SESSION: 'auth-work',
                npm_config_cache: '/cache',
                PATH: '/bin',
            },
        );

        expect(launch.options.env).toEqual({
            npm_config_cache: '/cache',
            PATH: '/bin',
        });
    });
});
