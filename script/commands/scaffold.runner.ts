import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCAFFOLDS, commandHelp, definition } from './catalog.ts';

/** Thin dispatcher; scaffolders retain their validation and rollback contracts. */
export function runScaffold(
    root: string,
    args: readonly string[],
    execute = (command: string, values: readonly string[], cwd: string): { status: number | null; error?: Error } =>
        spawnSync(command, [...values], { cwd, stdio: 'inherit' }),
    write = (value: string) => { process.stdout.write(value); },
): number {
    const [kind, ...values] = args;
    if (!kind || (kind === '--help' && values.length === 0)) {
        write(commandHelp(['scaffold']));
        return 0;
    }
    const selected = definition(SCAFFOLDS, kind);
    if (!selected) throw new Error(`Unknown scaffold type '${kind}'. Use npm run help -- scaffold.`);
    if (values.length === 1 && values[0] === '--help') {
        write(commandHelp(['scaffold', kind]));
        return 0;
    }
    const lengths: Record<keyof typeof SCAFFOLDS, readonly number[]> = {
        file: [3, 5], module: [1], operation: [7], test: [1], route: [1], component: [2], feature: [1], pwa: [5],
    };
    if (!definition(lengths, kind)?.includes(values.length)) {
        throw new Error(`Invalid ${kind} arguments.\n${commandHelp(['scaffold', kind])}`);
    }
    const result = execute(process.execPath, [path.join(root, selected.entry),
        ...('argument' in selected ? [selected.argument] : []), ...values], root);
    if (result.error) throw result.error;
    return result.status ?? 2;
}
