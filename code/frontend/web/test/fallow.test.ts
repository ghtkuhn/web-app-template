import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { FallowAudit } from '../../../../script/fallow.ts';

const roots: string[] = [];

function fixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fallow-audit-'));
    roots.push(root);
    const manifest = path.join(root, 'node_modules/fallow/package.json');
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, JSON.stringify({ version: '3.15.0' }));
    return root;
}

function report(introduced: number): string {
    return JSON.stringify({
        kind: 'audit',
        version: '3.15.0',
        verdict: introduced === 0 ? 'pass' : 'fail',
        summary: { dead_code_issues: 3 },
        attribution: {
            dead_code_introduced: introduced,
            dead_code_inherited: 3,
        },
    });
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Fallow inherited findings remain report-only', () => {
    const audit = new FallowAudit(fixture(), () => ({
        status: 1,
        stdout: report(0),
        stderr: '',
    }));

    expect(audit.run()).toBe(0);
});

test('Fallow introduced findings fail the audit', () => {
    const audit = new FallowAudit(fixture(), () => ({
        status: 1,
        stdout: report(2),
        stderr: '',
    }));

    expect(audit.run()).toBe(1);
});

test('Fallow malformed reports fail as execution errors', () => {
    const audit = new FallowAudit(fixture(), () => ({
        status: 0,
        stdout: '{invalid',
        stderr: '',
    }));

    expect(audit.run()).toBe(2);
});
