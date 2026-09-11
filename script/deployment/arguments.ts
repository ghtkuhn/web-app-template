import { parseArgs } from 'node:util';
import { DEPLOYMENTS, commandHelp, definition } from '../commands/catalog.ts';

/** Checks command shape before configuration, secrets, or external actions are accessed. */
export function validateDeploymentArguments(args: readonly string[]): void {
    const [command, ...rest] = args;
    if (!command || !definition(DEPLOYMENTS, command)) {
        throw new Error(`Unknown deployment action '${command ?? ''}'. Use npm run help -- deployment.`);
    }
    const fail = (reason: string): never => { throw new Error(`${reason}\n${commandHelp(['deployment', command])}`); };
    if (command === 'scaffold') {
        try {
            const parsed = parseArgs({ args: [...rest], allowPositionals: true, strict: true, options: {
                from: { type: 'string' }, 'backend-driver': { type: 'string' },
                'frontend-driver': { type: 'string' }, database: { type: 'string' },
            } });
            if (parsed.positionals.length !== 1 || !parsed.positionals[0]) fail('A single profile name is required.');
            for (const key of Object.keys(parsed.values)) {
                if (rest.filter((value) => value === `--${key}` || value.startsWith(`--${key}=`)).length !== 1) fail(`Duplicate option --${key}.`);
                if (!parsed.values[key as keyof typeof parsed.values]) fail(`Empty option --${key}.`);
            }
            for (const key of ['backend-driver', 'frontend-driver'] as const) {
                if (parsed.values[key] && !['docker', 'existing-lxc', 'proxmox-lxc'].includes(parsed.values[key])) fail(`Invalid ${key}.`);
            }
            if (parsed.values.database && !['sqlite', 'postgres'].includes(parsed.values.database)) fail('Invalid database dialect.');
        } catch (error) { fail(error instanceof Error ? error.message : 'Invalid scaffold options.'); }
        return;
    }
    if (command === 'validate' && rest.length === 1 && rest[0] === '--all') return;
    if (rest.some((value) => !value || value.startsWith('-'))) fail('Unknown option or empty argument.');
    if (command === 'validate' || command === 'database:list') {
        if (rest.length !== 1) fail('An explicit profile is required; extra arguments are forbidden.');
    } else if (command === 'database:restore') {
        if (rest.length !== 2 || rest[1] === 'latest') fail('An explicit profile and backup ID (not latest) are required.');
    } else {
        const rollback = command === 'rollback';
        if (rest.length < 2 || rest.length > (rollback ? 3 : 2)) fail('An explicit profile and component are required; extra arguments are forbidden.');
        if (!(rollback ? ['backend', 'frontend'] : ['backend', 'frontend', 'all']).includes(rest[1])) fail('Invalid component selection.');
    }
}
