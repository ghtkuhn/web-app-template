import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { DiagnosticCatalog } from '../../../../../script/lint-diagnostics/diagnostic.catalog.ts';
import { DiagnosticRenderer } from '../../../../../script/lint-diagnostics/diagnostic.renderer.ts';
import type {
    ArchitectureConcept,
    RuleDefinition,
} from '../../../../../script/lint-diagnostics/interfaces.ts';
import { RuleCatalog as BackendRuleCatalog } from '../../../../../code/backend/script/linter/rule.catalog.ts';
import { RuleCatalog as FrontendRuleCatalog } from '../../script/linter/rule.catalog.ts';

const CONCEPTS = {
    contract: {
        context: 'Expected architecture context.',
    },
} as const satisfies Record<string, ArchitectureConcept>;

const RULES = {
    EXAMPLE_RULE: {
        title: 'Example title',
        why: 'Example invariant.',
        meaning: 'Example consequence.',
        concept: 'contract',
        fixSteps: ['Repair {{subject}}.'],
        verify: ['npm run lint'],
    },
} as const satisfies Record<string, RuleDefinition<'contract'>>;

test('backend and frontend catalogs validate without generic fallbacks', () => {
    expect(() => new BackendRuleCatalog()).not.toThrow();
    expect(() => new FrontendRuleCatalog()).not.toThrow();
});

test('diagnostic catalogs reject incomplete teaching material', () => {
    const incomplete = {
        EXAMPLE_RULE: {
            ...RULES.EXAMPLE_RULE,
            fixSteps: [],
        },
    } satisfies Record<string, RuleDefinition<'contract'>>;
    expect(
        () => new DiagnosticCatalog(CONCEPTS, incomplete),
    ).toThrow(/no fix steps/u);
});

test('diagnostic catalogs reject unresolved dynamic evidence', () => {
    const catalog = new DiagnosticCatalog(CONCEPTS, RULES);
    expect(() => catalog.create({
        ruleId: 'EXAMPLE_RULE',
        severity: 'error',
        file: 'example.ts',
        observed: 'Observed {{missing}}.',
    })).toThrow(/did not provide placeholder/u);
});

test('renderer emits a complete review and a three-line code frame', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-renderer-'));
    try {
        fs.writeFileSync(
            path.join(root, 'example.ts'),
            'const before = true;\nconst broken = false;\nconst after = true;\n',
            'utf8',
        );
        const catalog = new DiagnosticCatalog(CONCEPTS, RULES);
        const issue = catalog.create({
            ruleId: 'EXAMPLE_RULE',
            severity: 'error',
            file: 'example.ts',
            observed: 'The value violates the example contract.',
            data: { subject: 'the value' },
            location: {
                start: { line: 2, column: 7 },
                end: { line: 2, column: 13 },
            },
            relatedLocations: [{
                file: 'example.ts',
                location: {
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 6 },
                },
                label: 'Related declaration',
            }],
        });
        const rendered = new DiagnosticRenderer(root).render(issue);
        expect(rendered).toContain('ERROR [EXAMPLE_RULE] Example title');
        expect(rendered).toContain('Where: example.ts:2:7');
        expect(rendered).toContain('1 | const before = true;');
        expect(rendered).toContain('2 | const broken = false;');
        expect(rendered).toContain('3 | const after = true;');
        expect(rendered).toContain('Related: Related declaration');
        expect(rendered).toContain('Found: The value violates');
        expect(rendered).toContain('Why: Example invariant.');
        expect(rendered).toContain('Meaning: Example consequence.');
        expect(rendered).toContain('Architecture: Expected architecture context.');
        expect(rendered).toContain('1. Repair the value.');
        expect(rendered).toContain('npm run lint');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
