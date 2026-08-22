import type {
    ArchitectureConcept,
    LintIssue,
    LintIssueDraft,
    RuleDefinition,
} from './interfaces.ts';

const PLACEHOLDER = /\{\{([a-z][a-zA-Z0-9]*)\}\}/gu;
const FORBIDDEN_REFERENCE = ['ARCHITECTURE', 'md'].join('.');

/** Validates and expands deterministic rule metadata into complete findings. */
export class DiagnosticCatalog<
    RuleId extends string,
    ConceptId extends string,
> {
    private readonly concepts: Readonly<Record<ConceptId, ArchitectureConcept>>;
    private readonly rules: Readonly<Record<RuleId, RuleDefinition<ConceptId>>>;

    public constructor(
        concepts: Readonly<Record<ConceptId, ArchitectureConcept>>,
        rules: Readonly<Record<RuleId, RuleDefinition<ConceptId>>>,
    ) {
        this.concepts = concepts;
        this.rules = rules;
        this.validate();
    }

    /** Materializes one self-contained review from dynamic source evidence. */
    public create(draft: LintIssueDraft<RuleId>): LintIssue<RuleId> {
        const definition = this.rules[draft.ruleId];
        if (!definition) {
            throw new Error(
                `Linter rule '${draft.ruleId}' has no diagnostic definition.`,
            );
        }
        const concept = this.concepts[definition.concept];
        if (!concept) {
            throw new Error(
                `Linter rule '${draft.ruleId}' references unknown concept ` +
                    `'${definition.concept}'.`,
            );
        }
        const data = draft.data ?? {};
        return {
            ruleId: draft.ruleId,
            severity: draft.severity,
            title: this.interpolate(definition.title, data, draft.ruleId),
            file: draft.file,
            location: draft.location ?? null,
            relatedLocations: draft.relatedLocations ?? [],
            observed: this.interpolate(draft.observed, data, draft.ruleId),
            why: this.interpolate(definition.why, data, draft.ruleId),
            meaning: this.interpolate(definition.meaning, data, draft.ruleId),
            context: this.interpolate(concept.context, data, draft.ruleId),
            fixSteps: definition.fixSteps.map((step) =>
                this.interpolate(step, data, draft.ruleId),
            ),
            verify: definition.verify.map((command) =>
                this.interpolate(command, data, draft.ruleId),
            ),
        };
    }

    /** Rejects incomplete teaching material before any source is analyzed. */
    private validate(): void {
        for (const [conceptId, concept] of Object.entries(
            this.concepts,
        ) as Array<[ConceptId, ArchitectureConcept]>) {
            this.assertText(`concept '${conceptId}'`, concept.context);
        }
        for (const [ruleId, definition] of Object.entries(this.rules) as Array<
            [RuleId, RuleDefinition<ConceptId>]
        >) {
            this.assertText(`rule '${ruleId}' title`, definition.title);
            this.assertText(`rule '${ruleId}' why`, definition.why);
            this.assertText(`rule '${ruleId}' meaning`, definition.meaning);
            if (!this.concepts[definition.concept]) {
                throw new Error(
                    `Linter rule '${ruleId}' references unknown concept ` +
                        `'${definition.concept}'.`,
                );
            }
            if (definition.fixSteps.length === 0) {
                throw new Error(`Linter rule '${ruleId}' has no fix steps.`);
            }
            if (definition.verify.length === 0) {
                throw new Error(
                    `Linter rule '${ruleId}' has no verification command.`,
                );
            }
            definition.fixSteps.forEach((step) =>
                this.assertText(`rule '${ruleId}' fix`, step),
            );
            definition.verify.forEach((command) =>
                this.assertText(`rule '${ruleId}' verification`, command),
            );
        }
    }

    private assertText(owner: string, value: string): void {
        if (!value.trim()) {
            throw new Error(`Linter ${owner} must not be empty.`);
        }
        if (value.includes(FORBIDDEN_REFERENCE)) {
            throw new Error(
                `Linter ${owner} references deleted architecture documentation.`,
            );
        }
    }

    private interpolate(
        template: string,
        data: Readonly<Record<string, string>>,
        ruleId: RuleId,
    ): string {
        return template.replace(PLACEHOLDER, (_match, key: string) => {
            const value = data[key];
            if (value === undefined) {
                throw new Error(
                    `Linter rule '${ruleId}' did not provide placeholder ` +
                        `'{{${key}}}'.`,
                );
            }
            return value;
        });
    }
}
