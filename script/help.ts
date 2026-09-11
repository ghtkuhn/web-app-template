import { commandHelp } from './commands/catalog.ts';

try {
    const args = process.argv.slice(2);
    process.stdout.write(commandHelp(args.length === 1 && args[0] === '--help' ? [] : args));
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unable to show help.'}\n`);
    process.exitCode = 1;
}
