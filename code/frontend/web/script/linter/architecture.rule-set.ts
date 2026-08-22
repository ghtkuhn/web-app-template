import path from 'node:path';
import type {
    DiagnosticLocation,
    LintIssueDraft,
    SourceAnalysis,
    SourceDependency,
    SourceSpan,
} from './interfaces.ts';
import {
    PathResolver,
    type FrontendLayer,
    type PresentationName,
} from './path.resolver.ts';

const PRESENTATIONS: readonly PresentationName[] = [
    'desktop',
    'tablet',
    'mobile',
];
const CORE_AREAS = [
    'api',
    'composables',
    'config',
    'models',
    'services',
];

/** Enforces source placement, layer direction, and Vue conventions. */
export class ArchitectureRuleSet {
    private readonly paths: PathResolver;

    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        return [
            ...this.placementIssues(analysis),
            ...this.dependencyIssues(analysis),
            ...this.ownershipIssues(analysis),
            ...this.vueIssues(analysis),
            ...this.routeCoverageIssues(analysis),
            ...this.picoOwnershipIssues(analysis),
            ...this.tablerIconOwnershipIssues(analysis),
        ];
    }

    /** Keeps Pico as one global semantic foundation instead of per-view imports. */
    private picoOwnershipIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        const relative = this.paths.relative(analysis.filePath);
        const isGlobalStyle = relative.endsWith(
            'code/frontend/web/src/shared/styles/main.css',
        );
        const imports = analysis.styles.flatMap((style) => style.imports);
        const importsPico = imports.includes('@picocss/pico');
        if (isGlobalStyle && !importsPico) {
            issues.push(this.issue(
                analysis,
                'PICO_GLOBAL_IMPORT_MISSING',
                'shared/styles/main.css must import Pico CSS from @picocss/pico.',
            ));
        }
        if (importsPico && !isGlobalStyle) {
            const evidence = analysis.styles
                .flatMap((style) => style.importEvidence)
                .find((entry) => entry.source === '@picocss/pico');
            issues.push(this.issue(
                analysis,
                'PICO_OWNERSHIP',
                'Pico CSS may only be imported by shared/styles/main.css.',
                evidence?.location,
            ));
        }
        if (
            imports.some((source) => this.isPicoRemoteSource(source)) ||
            (analysis.isVue && this.hasPicoRemoteLink(analysis.source))
        ) {
            issues.push(this.issue(
                analysis,
                'PICO_CDN_FORBIDDEN',
                'Pico CSS must be installed through npm, not loaded from a CDN.',
                this.remoteStyleLocation(analysis, this.isPicoRemoteSource),
            ));
        }
        return issues;
    }

    /** Keeps the bundled Tabler font available through one shared style entry. */
    private tablerIconOwnershipIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        const relative = this.paths.relative(analysis.filePath);
        const isGlobalStyle = relative.endsWith(
            'code/frontend/web/src/shared/styles/main.css',
        );
        const isTablerStyle = relative.endsWith(
            'code/frontend/web/src/shared/styles/tabler/tabler-icons.css',
        );
        const imports = analysis.styles.flatMap((style) => style.imports);
        const importsTabler = imports.some((source) =>
            source.endsWith('tabler-icons.css'),
        );
        if (isGlobalStyle && !importsTabler) {
            issues.push(this.issue(
                analysis,
                'TABLER_ICON_GLOBAL_IMPORT_MISSING',
                'shared/styles/main.css must import the local Tabler icon stylesheet.',
            ));
        }
        if (importsTabler && !isGlobalStyle && !isTablerStyle) {
            const evidence = analysis.styles
                .flatMap((style) => style.importEvidence)
                .find((entry) => entry.source.endsWith('tabler-icons.css'));
            issues.push(this.issue(
                analysis,
                'TABLER_ICON_OWNERSHIP',
                'The Tabler icon stylesheet may only be imported by shared/styles/main.css.',
                evidence?.location,
            ));
        }
        if (
            imports.some((source) => this.isTablerRemoteSource(source)) ||
            (analysis.isVue && this.hasTablerRemoteLink(analysis.source))
        ) {
            issues.push(this.issue(
                analysis,
                'TABLER_ICON_CDN_FORBIDDEN',
                'Tabler Icons must use the bundled local font, not a CDN.',
                this.remoteStyleLocation(analysis, this.isTablerRemoteSource),
            ));
        }
        return issues;
    }

    private isPicoRemoteSource(source: string): boolean {
        return /^https?:\/\//iu.test(source) &&
            /(?:picocss\.com|@picocss\/pico)/iu.test(source);
    }

    private hasPicoRemoteLink(source: string): boolean {
        return /<link\b[^>]*href=["']https?:\/\/[^"']*(?:picocss\.com|@picocss\/pico)[^"']*["']/iu.test(
            source,
        );
    }

    private isTablerRemoteSource(source: string): boolean {
        return /^https?:\/\//iu.test(source) && /tabler/iu.test(source);
    }

    private hasTablerRemoteLink(source: string): boolean {
        return /<link\b[^>]*href=["']https?:\/\/[^"']*tabler[^"']*["']/iu.test(
            source,
        );
    }

    private placementIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const segments = this.paths.segments(analysis.filePath);
        const layer = this.paths.layer(analysis.filePath);
        if (layer === 'root' && segments.join('/') !== 'main.ts') {
            return [
                this.issue(
                    analysis,
                    'FRONTEND_SOURCE_PLACEMENT',
                    'Only main.ts may be placed directly below src/.',
                ),
            ];
        }
        return [
            ...this.corePlacementIssues(analysis, segments, layer),
            ...this.presentationPlacementIssues(
                analysis,
                segments,
                layer,
            ),
        ];
    }

    private corePlacementIssues(
        analysis: SourceAnalysis,
        segments: readonly string[],
        layer: FrontendLayer,
    ): LintIssueDraft[] {
        if (
            layer === 'core' &&
            (segments.length < 3 || !CORE_AREAS.includes(segments[1]))
        ) {
            return [
                this.issue(
                    analysis,
                    'CORE_STRUCTURE',
                    'Core files must live in api, composables, config, models, or services.',
                ),
            ];
        }
        return [];
    }

    private presentationPlacementIssues(
        analysis: SourceAnalysis,
        segments: readonly string[],
        layer: FrontendLayer,
    ): LintIssueDraft[] {
        if (layer !== 'presentation') {
            return [];
        }
        const valid =
            segments.length === 4 &&
            PRESENTATIONS.includes(segments[1] as PresentationName) &&
            ['layouts', 'views', 'components'].includes(segments[2]);
        return valid
            ? []
            : [
                  this.issue(
                      analysis,
                      'PRESENTATION_STRUCTURE',
                      'Presentation files must use presentation/<desktop|tablet|mobile>/<layouts|views|components>/.',
                  ),
              ];
    }

    private dependencyIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        for (const dependency of analysis.dependencies) {
            issues.push(...this.dependencyIssue(analysis, dependency));
        }
        return issues;
    }

    private dependencyIssue(
        analysis: SourceAnalysis,
        dependency: SourceDependency,
    ): LintIssueDraft[] {
        const target = this.paths.resolveDependency(
            analysis.filePath,
            dependency.source,
        );
        if (!target || !this.paths.isWithinSource(target)) {
            return [];
        }
        const sourceLayer = this.paths.layer(analysis.filePath);
        const targetLayer = this.paths.layer(target);
        const sourcePresentation = this.paths.presentation(analysis.filePath);
        const targetPresentation = this.paths.presentation(target);
        const presentationIssue = this.presentationDependencyIssue(
            analysis,
            dependency,
            target,
            sourcePresentation,
            targetPresentation,
        );
        if (presentationIssue) {
            return [presentationIssue];
        }
        const layerIssue = this.layerDependencyIssue(
            analysis,
            dependency,
            sourceLayer,
            targetLayer,
        );
        if (layerIssue) {
            return [layerIssue];
        }
        const coreIssue = this.coreDependencyIssue(
            analysis,
            dependency,
            target,
            sourceLayer,
            targetLayer,
        );
        return coreIssue ? [coreIssue] : [];
    }

    private presentationDependencyIssue(
        analysis: SourceAnalysis,
        dependency: SourceDependency,
        target: string,
        sourcePresentation: PresentationName | null,
        targetPresentation: PresentationName | null,
    ): LintIssueDraft | null {
        if (
            sourcePresentation &&
            targetPresentation &&
            sourcePresentation !== targetPresentation
        ) {
            return this.issue(
                analysis,
                'PRESENTATION_CROSS_IMPORT',
                `${sourcePresentation} may not depend on ${targetPresentation}.`,
                dependency.location,
                [{
                    file: this.paths.relative(target),
                    location: null,
                    label: 'Imported file in another device presentation',
                }],
            );
        }
        return null;
    }

    private layerDependencyIssue(
        analysis: SourceAnalysis,
        dependency: SourceDependency,
        sourceLayer: FrontendLayer,
        targetLayer: FrontendLayer,
    ): LintIssueDraft | null {
        if (!this.layerAllows(sourceLayer, targetLayer)) {
            return this.issue(
                analysis,
                'FRONTEND_LAYER_DIRECTION',
                `${sourceLayer} may not depend on ${dependency.source}.`,
                dependency.location,
            );
        }
        return null;
    }

    private coreDependencyIssue(
        analysis: SourceAnalysis,
        dependency: SourceDependency,
        target: string,
        sourceLayer: FrontendLayer,
        targetLayer: FrontendLayer,
    ): LintIssueDraft | null {
        if (
            sourceLayer === 'core' &&
            targetLayer === 'core' &&
            !this.coreDependencyAllowed(analysis.filePath, target)
        ) {
            return this.issue(
                analysis,
                'CORE_LAYER_DIRECTION',
                `core/${this.paths.segments(analysis.filePath)[1]} may not depend on core/${this.paths.segments(target)[1]}.`,
                dependency.location,
            );
        }
        return null;
    }

    private coreDependencyAllowed(
        sourceFile: string,
        targetFile: string,
    ): boolean {
        return this.coreAllows(
            this.paths.segments(sourceFile)[1],
            this.paths.segments(targetFile)[1],
        );
    }

    private coreAllows(source: string, target: string): boolean {
        const allowed: Record<string, readonly string[]> = {
            api: ['api'],
            composables: [
                'api',
                'composables',
                'config',
                'models',
                'services',
            ],
            config: ['config'],
            models: ['models'],
            services: ['api', 'models', 'services'],
        };
        return allowed[source]?.includes(target) ?? false;
    }

    private layerAllows(
        source: FrontendLayer,
        target: FrontendLayer,
    ): boolean {
        const allowed: Record<FrontendLayer, readonly FrontendLayer[]> = {
            app: ['app', 'core', 'presentation', 'shared'],
            core: ['core', 'shared'],
            presentation: ['presentation', 'core', 'shared'],
            shared: ['shared'],
            root: ['app', 'shared'],
        };
        return allowed[source].includes(target);
    }

    private ownershipIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        return [
            ...this.routerOwnershipIssues(analysis),
            ...this.presentationOwnershipIssues(analysis),
            ...this.environmentOwnershipIssues(analysis),
            ...this.authStorageOwnershipIssues(analysis),
            ...this.networkOwnershipIssues(analysis),
        ];
    }

    private routerOwnershipIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const relative = this.paths.relative(analysis.filePath);
        const isRouter = relative.endsWith(
            'code/frontend/web/src/app/router.ts',
        );
        if (
            !isRouter &&
            analysis.calls.some((call) =>
                ['createRouter', 'createWebHistory'].includes(call),
            )
        ) {
            const evidence = analysis.callEvidence.find((entry) =>
                ['createRouter', 'createWebHistory'].includes(entry.name),
            );
            return [this.issue(
                analysis,
                'ROUTER_OWNERSHIP',
                'Router creation belongs in app/router.ts.',
                evidence?.location,
            )];
        }
        return [];
    }

    private presentationOwnershipIssues(
        analysis: SourceAnalysis,
    ): LintIssueDraft[] {
        const relative = this.paths.relative(analysis.filePath);
        const isPresentationOwner = relative.endsWith(
            'code/frontend/web/src/app/presentation.ts',
        );
        if (
            !isPresentationOwner &&
            (analysis.calls.some((call) => call.endsWith('matchMedia')) ||
                analysis.members.some((member) =>
                    ['innerWidth', 'userAgentData'].includes(member),
                ))
        ) {
            const evidence =
                analysis.callEvidence.find((entry) =>
                    entry.name.endsWith('matchMedia'),
                ) ??
                analysis.memberEvidence.find((entry) =>
                    ['innerWidth', 'userAgentData'].includes(entry.name),
                );
            return [this.issue(
                analysis,
                'PRESENTATION_BREAKPOINT_OWNERSHIP',
                'Viewport and device detection belongs in app/presentation.ts.',
                evidence?.location,
            )];
        }
        return [];
    }

    private environmentOwnershipIssues(
        analysis: SourceAnalysis,
    ): LintIssueDraft[] {
        const relative = this.paths.relative(analysis.filePath);
        const isEnvironmentOwner = relative.includes(
            'code/frontend/web/src/core/config/',
        );
        if (!isEnvironmentOwner && analysis.source.includes('import.meta.env')) {
            return [this.issue(
                analysis,
                'FRONTEND_ENV_OWNERSHIP',
                'Vite environment access belongs in core/config.',
                this.textLocation(analysis.source, 'import.meta.env'),
            )];
        }
        return [];
    }

    private networkOwnershipIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const layer = this.paths.layer(analysis.filePath);
        if (layer === 'presentation') {
            const importsApi = analysis.dependencies.some((dependency) => {
                const target = this.paths.resolveDependency(
                    analysis.filePath,
                    dependency.source,
                );
                return target?.includes(
                    `${path.sep}core${path.sep}api${path.sep}`,
                );
            });
            if (
                importsApi ||
                analysis.calls.some(
                    (call) => call === 'fetch' || call.endsWith('.fetch'),
                )
            ) {
                const dependencyEvidence = analysis.dependencies.find(
                    (dependency) => {
                        const target = this.paths.resolveDependency(
                            analysis.filePath,
                            dependency.source,
                        );
                        return target?.includes(
                            `${path.sep}core${path.sep}api${path.sep}`,
                        );
                    },
                );
                const callEvidence = analysis.callEvidence.find(
                    (entry) =>
                        entry.name === 'fetch' ||
                        entry.name.endsWith('.fetch'),
                );
                return [this.issue(
                    analysis,
                    'PRESENTATION_NETWORK_ACCESS',
                    'Presentation code must use application composables instead of network access.',
                    dependencyEvidence?.location ?? callEvidence?.location,
                )];
            }
        }
        return [];
    }

    /** Keeps JavaScript-readable Auth credentials behind one explicit owner. */
    private authStorageOwnershipIssues(
        analysis: SourceAnalysis,
    ): LintIssueDraft[] {
        const relative = this.paths.relative(analysis.filePath);
        const isTokenStore = relative.endsWith(
            'code/frontend/web/src/core/api/auth-token.store.ts',
        );
        if (!isTokenStore && analysis.source.includes('sessionStorage')) {
            return [this.issue(
                analysis,
                'AUTH_TOKEN_STORAGE_OWNERSHIP',
                'sessionStorage access belongs exclusively in core/api/auth-token.store.ts.',
                this.textLocation(analysis.source, 'sessionStorage'),
            )];
        }
        return [];
    }

    private vueIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        return [
            ...this.vueStructureIssues(analysis),
            ...this.vueNamingIssues(analysis),
            ...this.vueStyleIssues(analysis),
        ];
    }

    private vueStructureIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        if (analysis.isVue && this.paths.layer(analysis.filePath) === 'shared') {
            issues.push(this.issue(
                analysis,
                'SHARED_VUE_COMPONENT',
                'Shared may contain assets and utilities, not Vue components.',
            ));
        }
        if (
            analysis.isVue &&
            analysis.hasScript &&
            (analysis.hasNormalScript ||
                !analysis.hasScriptSetup ||
                analysis.scriptLanguage !== 'ts')
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'VUE_SCRIPT_SETUP',
                    'Vue scripts must use <script setup lang="ts">.',
                    analysis.scriptLocation ?? analysis.scriptSetupLocation ?? undefined,
                ),
            );
        }
        return issues;
    }

    private vueNamingIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        if (analysis.isVue && !/^[A-Z][A-Za-z0-9]*\.vue$/.test(
            path.basename(analysis.filePath),
        )) {
            issues.push(
                this.issue(
                    analysis,
                    'VUE_COMPONENT_NAME',
                    'Vue component filenames must use PascalCase.',
                ),
            );
        }

        const segments = this.paths.segments(analysis.filePath);
        const basename = path.basename(analysis.filePath);
        if (
            analysis.isVue &&
            ((segments[2] === 'views' && !basename.endsWith('View.vue')) ||
                (segments[2] === 'layouts' &&
                    !basename.endsWith('Layout.vue')))
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'VUE_COMPONENT_NAME',
                    'Presentation views and layouts require View.vue and Layout.vue suffixes.',
                ),
            );
        }
        return issues;
    }

    private vueStyleIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        const layer = this.paths.layer(analysis.filePath);
        if (
            layer === 'presentation' &&
            analysis.styles.some((style) => !style.scoped)
        ) {
            const style = analysis.styles.find((entry) => !entry.scoped);
            issues.push(
                this.issue(
                    analysis,
                    'PRESENTATION_STYLE_SCOPE',
                    'Presentation SFC styles must be scoped.',
                    style?.location,
                ),
            );
        }
        if (
            ['presentation', 'shared'].includes(layer) &&
            analysis.styles.some((style) =>
                style.atRules.some(
                    (atRule) =>
                        atRule.name.toLowerCase() === 'media' &&
                        /(?:min|max)-width/iu.test(atRule.parameters),
                ),
            )
        ) {
            const media = analysis.styles
                .flatMap((style) => style.atRules)
                .find(
                    (atRule) =>
                        atRule.name.toLowerCase() === 'media' &&
                        /(?:min|max)-width/iu.test(atRule.parameters),
                );
            issues.push(
                this.issue(
                    analysis,
                    'PRESENTATION_MEDIA_QUERY',
                    'Width breakpoints belong to the central presentation selector.',
                    media?.location,
                ),
            );
        }
        const rawToken = this.rawTokenLocation(analysis);
        if (layer === 'presentation' && rawToken) {
            issues.push(
                this.issue(
                    analysis,
                    'DESIGN_TOKEN_USAGE',
                    'Presentation colors, font sizes, radii, and z-index values must use shared tokens.',
                    rawToken,
                ),
            );
        }
        return issues;
    }

    private rawTokenLocation(analysis: SourceAnalysis): SourceSpan | null {
        const resetValues = new Set([
            'inherit',
            'initial',
            'revert',
            'revert-layer',
            'unset',
        ]);
        const tokenProperties = new Set([
            'background',
            'background-color',
            'border-radius',
            'color',
            'font-size',
            'z-index',
        ]);
        for (const style of analysis.styles) {
            for (const declaration of style.declarations) {
                const property = declaration.property.toLowerCase();
                const value = declaration.value.trim().toLowerCase();
                const allowedFontReset = property === 'font-size' &&
                    (value === '0' || resetValues.has(value));
                if (
                    tokenProperties.has(property) &&
                    !declaration.value.trim().startsWith('var(') &&
                    !allowedFontReset
                ) {
                    return declaration.location;
                }
            }
        }
        return null;
    }

    private routeCoverageIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const segments = this.paths.segments(analysis.filePath);
        if (
            segments[0] !== 'app' ||
            segments[1] !== 'routes' ||
            !analysis.isVue
        ) {
            return [];
        }
        const presentations = new Set(
            analysis.dependencies
                .map((dependency) =>
                    this.paths.resolveDependency(
                        analysis.filePath,
                        dependency.source,
                    ),
                )
                .filter((target): target is string => Boolean(target))
                .map((target) => this.paths.presentation(target))
                .filter(
                    (name): name is PresentationName => name !== null,
                ),
        );
        return PRESENTATIONS.every((name) => presentations.has(name)) &&
            presentations.size === PRESENTATIONS.length
            ? []
            : [
                  this.issue(
                      analysis,
                      'ROUTE_PRESENTATION_COVERAGE',
                      'Route adapters must import desktop, tablet, and mobile views.',
                  ),
              ];
    }

    private remoteStyleLocation(
        analysis: SourceAnalysis,
        predicate: (source: string) => boolean,
    ): SourceSpan | undefined {
        const imported = analysis.styles
            .flatMap((style) => style.importEvidence)
            .find((entry) => predicate(entry.source));
        if (imported) {
            return imported.location;
        }
        const match = analysis.source.match(/https?:\/\/[^"'\s>]+/iu);
        return match?.index === undefined
            ? undefined
            : this.offsetLocation(
                  analysis.source,
                  match.index,
                  match.index + match[0].length,
              );
    }

    private textLocation(source: string, text: string): SourceSpan | undefined {
        const start = source.indexOf(text);
        return start < 0
            ? undefined
            : this.offsetLocation(source, start, start + text.length);
    }

    private offsetLocation(
        source: string,
        start: number,
        end: number,
    ): SourceSpan {
        const position = (offset: number): { line: number; column: number } => {
            const before = source.slice(0, offset);
            const previousNewline = before.lastIndexOf('\n');
            return {
                line: before.split('\n').length,
                column: offset - previousNewline,
            };
        };
        return { start: position(start), end: position(end) };
    }

    private issue(
        analysis: SourceAnalysis,
        ruleId: LintIssueDraft['ruleId'],
        observed: string,
        location?: SourceSpan,
        relatedLocations?: readonly DiagnosticLocation[],
    ): LintIssueDraft {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(analysis.filePath),
            observed,
            location,
            relatedLocations,
        };
    }
}
