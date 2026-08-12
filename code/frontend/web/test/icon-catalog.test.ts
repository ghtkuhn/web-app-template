import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
    IconCatalogCli,
    TablerIconCatalog,
    type IconCatalogWriter,
} from '../script/icon-catalog.ts';

const temporaryDirectories: string[] = [];

/** Captures CLI output without writing to the process streams. */
class BufferWriter implements IconCatalogWriter {
    public value = '';

    public write(chunk: string): void {
        this.value += chunk;
    }
}

/** Creates one compact standalone Tabler stylesheet fixture. */
function stylesheetFixture(source: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tabler-icons-'));
    temporaryDirectories.push(directory);
    const stylesheet = path.join(directory, 'tabler-icons.css');
    fs.writeFileSync(stylesheet, source, 'utf8');
    return stylesheet;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('the catalog extracts and sorts locally bundled Tabler icon declarations', () => {
    const catalog = new TablerIconCatalog(stylesheetFixture(
        '.ti-zebra:before { content: "\\f001"; }\n' +
            '.ti-home:before { content: "\\ef10"; }\n',
    ));

    expect(catalog.icons()).toEqual([
        { name: 'home', codePoint: 'EF10' },
        { name: 'zebra', codePoint: 'F001' },
    ]);
    expect(catalog.search('ome')).toEqual([
        { name: 'home', codePoint: 'EF10' },
    ]);
});

test('the CLI prints usable classes and visual-reference URLs', () => {
    const catalog = new TablerIconCatalog(stylesheetFixture(
        '.ti-home:before { content: "\\ef10"; }\n',
    ));
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    expect(new IconCatalogCli(catalog, stdout, stderr).run(['home'])).toBe(0);
    expect(stdout.value).toContain('ti ti-home\tU+EF10');
    expect(stdout.value).toContain('https://tabler.io/icons/icon/home');
    expect(stderr.value).toBe('');
});

test('the CLI has stable help and no-match exit codes', () => {
    const catalog = new TablerIconCatalog(stylesheetFixture(''));
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();
    const cli = new IconCatalogCli(catalog, stdout, stderr);

    expect(cli.run(['--help'])).toBe(0);
    expect(stdout.value).toContain('Usage: npm run icons -- <search-term>');
    expect(cli.run(['home'])).toBe(1);
    expect(stderr.value).toContain('No bundled Tabler icons match "home".');
    expect(cli.run([])).toBe(2);
});
