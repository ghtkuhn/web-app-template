import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** One searchable icon from the locally bundled Tabler outline font. */
export interface TablerIcon {
    readonly name: string;
    readonly codePoint: string;
}

/** Output destination used by the catalog command and its tests. */
export interface IconCatalogWriter {
    write(chunk: string): unknown;
}

/** Reads the versioned local Tabler stylesheet without any network access. */
export class TablerIconCatalog {
    private readonly stylesheetPath: string;

    constructor(stylesheetPath: string = TablerIconCatalog.defaultStylesheetPath()) {
        this.stylesheetPath = stylesheetPath;
    }

    /** Returns bundled icons whose name contains the supplied search term. */
    public search(searchTerm: string): readonly TablerIcon[] {
        const normalizedTerm = searchTerm.trim().toLowerCase();
        return this.icons().filter((icon) =>
            icon.name.includes(normalizedTerm),
        );
    }

    /** Returns every bundled icon in deterministic name order. */
    public icons(): readonly TablerIcon[] {
        const stylesheet = fs.readFileSync(this.stylesheetPath, 'utf8');
        const entries: TablerIcon[] = [];
        const declaration = /\.ti-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)";\s*\}/giu;
        for (const match of stylesheet.matchAll(declaration)) {
            entries.push({
                name: match[1],
                codePoint: match[2].toUpperCase(),
            });
        }
        return entries.sort((left, right) =>
            left.name.localeCompare(right.name),
        );
    }

    private static defaultStylesheetPath(): string {
        return path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            '../src/shared/styles/tabler/tabler-icons.css',
        );
    }
}

/** Provides a concise shell interface for selecting a bundled Tabler icon. */
export class IconCatalogCli {
    private readonly catalog: TablerIconCatalog;
    private readonly stdout: IconCatalogWriter;
    private readonly stderr: IconCatalogWriter;

    constructor(
        catalog: TablerIconCatalog = new TablerIconCatalog(),
        stdout: IconCatalogWriter = process.stdout,
        stderr: IconCatalogWriter = process.stderr,
    ) {
        this.catalog = catalog;
        this.stdout = stdout;
        this.stderr = stderr;
    }

    /** Searches icons and returns a stable exit code for shell callers. */
    public run(arguments_: readonly string[]): number {
        const argument = arguments_[0];
        if (argument === '--help' || argument === '-h') {
            this.writeHelp(this.stdout);
            return 0;
        }
        if (argument === '--all' && arguments_.length === 1) {
            this.writeIcons('all', this.catalog.icons());
            return 0;
        }
        if (!argument || arguments_.length !== 1) {
            this.writeHelp(this.stderr);
            return 2;
        }
        const icons = this.catalog.search(argument);
        if (icons.length === 0) {
            this.stderr.write(`No bundled Tabler icons match "${argument}".\n`);
            return 1;
        }
        this.writeIcons(argument, icons);
        return 0;
    }

    private writeIcons(searchTerm: string, icons: readonly TablerIcon[]): void {
        this.stdout.write(
            `Tabler Icons v3.46.0 — ${icons.length} match(es) for "${searchTerm}".\n`,
        );
        for (const icon of icons) {
            this.stdout.write(
                `ti ti-${icon.name}\tU+${icon.codePoint}\thttps://tabler.io/icons/icon/${icon.name}\n`,
            );
        }
    }

    private writeHelp(writer: IconCatalogWriter): void {
        writer.write(
            'Usage: npm run icons -- <search-term>\n' +
                '       npm run icons -- --all\n' +
                'Exit codes: 0 matches, 1 no match, 2 invalid usage.\n',
        );
    }
}

const entryPoint = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entryPoint) {
    process.exitCode = new IconCatalogCli().run(process.argv.slice(2));
}
