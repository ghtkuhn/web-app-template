import path from 'node:path';
import type {
    LintIssue,
    SourceAnalysis,
    SourceDependency,
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

    public evaluate(analysis: SourceAnalysis): LintIssue[] {
        return [
            ...this.placementIssues(analysis),
            ...this.dependencyIssues(analysis),
            ...this.ownershipIssues(analysis),
            ...this.vueIssues(analysis),
            ...this.routeCoverageIssues(analysis),
        ];
    }

    private placementIssues(analysis: SourceAnalysis): LintIssue[] {
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
    ): LintIssue[] {
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
    ): LintIssue[] {
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

    private dependencyIssues(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
        for (const dependency of analysis.dependencies) {
            issues.push(...this.dependencyIssue(analysis, dependency));
        }
        return issues;
    }

    private dependencyIssue(
        analysis: SourceAnalysis,
        dependency: SourceDependency,
    ): LintIssue[] {
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
            target,
            sourceLayer,
            targetLayer,
        );
        return coreIssue ? [coreIssue] : [];
    }

    private presentationDependencyIssue(
        analysis: SourceAnalysis,
        sourcePresentation: PresentationName | null,
        targetPresentation: PresentationName | null,
    ): LintIssue | null {
        if (
            sourcePresentation &&
            targetPresentation &&
            sourcePresentation !== targetPresentation
        ) {
            return this.issue(
                analysis,
                'PRESENTATION_CROSS_IMPORT',
                `${sourcePresentation} may not depend on ${targetPresentation}.`,
            );
        }
        return null;
    }

    private layerDependencyIssue(
        analysis: SourceAnalysis,
        dependency: SourceDependency,
        sourceLayer: FrontendLayer,
        targetLayer: FrontendLayer,
    ): LintIssue | null {
        if (!this.layerAllows(sourceLayer, targetLayer)) {
            return this.issue(
                analysis,
                'FRONTEND_LAYER_DIRECTION',
                `${sourceLayer} may not depend on ${dependency.source}.`,
            );
        }
        return null;
    }

    private coreDependencyIssue(
        analysis: SourceAnalysis,
        target: string,
        sourceLayer: FrontendLayer,
        targetLayer: FrontendLayer,
    ): LintIssue | null {
        if (
            sourceLayer === 'core' &&
            targetLayer === 'core' &&
            !this.coreDependencyAllowed(analysis.filePath, target)
        ) {
            return this.issue(
                analysis,
                'CORE_LAYER_DIRECTION',
                `core/${this.paths.segments(analysis.filePath)[1]} may not depend on core/${this.paths.segments(target)[1]}.`,
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

    private ownershipIssues(analysis: SourceAnalysis): LintIssue[] {
        return [
            ...this.routerOwnershipIssues(analysis),
            ...this.presentationOwnershipIssues(analysis),
            ...this.environmentOwnershipIssues(analysis),
            ...this.networkOwnershipIssues(analysis),
        ];
    }

    private routerOwnershipIssues(analysis: SourceAnalysis): LintIssue[] {
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
            return [this.issue(
                analysis,
                'ROUTER_OWNERSHIP',
                'Router creation belongs in app/router.ts.',
            )];
        }
        return [];
    }

    private presentationOwnershipIssues(
        analysis: SourceAnalysis,
    ): LintIssue[] {
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
            return [this.issue(
                analysis,
                'PRESENTATION_BREAKPOINT_OWNERSHIP',
                'Viewport and device detection belongs in app/presentation.ts.',
            )];
        }
        return [];
    }

    private environmentOwnershipIssues(
        analysis: SourceAnalysis,
    ): LintIssue[] {
        const relative = this.paths.relative(analysis.filePath);
        const isEnvironmentOwner = relative.includes(
            'code/frontend/web/src/core/config/',
        );
        if (!isEnvironmentOwner && analysis.source.includes('import.meta.env')) {
            return [this.issue(
                analysis,
                'FRONTEND_ENV_OWNERSHIP',
                'Vite environment access belongs in core/config.',
            )];
        }
        return [];
    }

    private networkOwnershipIssues(analysis: SourceAnalysis): LintIssue[] {
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
                return [this.issue(
                    analysis,
                    'PRESENTATION_NETWORK_ACCESS',
                    'Presentation code must use application composables instead of network access.',
                )];
            }
        }
        return [];
    }

    private vueIssues(analysis: SourceAnalysis): LintIssue[] {
        return [
            ...this.vueStructureIssues(analysis),
            ...this.vueNamingIssues(analysis),
            ...this.vueStyleIssues(analysis),
        ];
    }

    private vueStructureIssues(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
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
                ),
            );
        }
        return issues;
    }

    private vueNamingIssues(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
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

    private vueStyleIssues(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
        const layer = this.paths.layer(analysis.filePath);
        if (
            layer === 'presentation' &&
            analysis.styles.some((style) => !style.scoped)
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'PRESENTATION_STYLE_SCOPE',
                    'Presentation SFC styles must be scoped.',
                ),
            );
        }
        const styleSource = [
            analysis.source,
            ...analysis.styles.map((style) => style.content),
        ].join('\n');
        if (
            ['presentation', 'shared'].includes(layer) &&
            /@media[^{]*(?:min|max)-width/i.test(styleSource)
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'PRESENTATION_MEDIA_QUERY',
                    'Width breakpoints belong to the central presentation selector.',
                ),
            );
        }
        if (
            layer === 'presentation' &&
            this.hasRawTokenValue(analysis)
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'DESIGN_TOKEN_USAGE',
                    'Presentation colors, font sizes, radii, and z-index values must use shared tokens.',
                ),
            );
        }
        return issues;
    }

    private hasRawTokenValue(analysis: SourceAnalysis): boolean {
        const declaration =
            /(?:color|background(?:-color)?|font-size|border-radius|z-index)\s*:\s*([^;]+);/gi;
        const styles = analysis.styles
            .map((style) => style.content)
            .join('\n');
        return [...styles.matchAll(declaration)].some(
            (match) => !match[1].trim().startsWith('var('),
        );
    }

    private routeCoverageIssues(analysis: SourceAnalysis): LintIssue[] {
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

    private issue(
        analysis: SourceAnalysis,
        ruleId: string,
        message: string,
    ): LintIssue {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(analysis.filePath),
            message,
        };
    }
}
