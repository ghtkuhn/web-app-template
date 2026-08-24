import { DiagnosticCatalog } from '../../../../../script/lint-diagnostics/diagnostic.catalog.ts';
import type {
    ArchitectureConcept,
    RuleDefinition,
} from '../../../../../script/lint-diagnostics/interfaces.ts';

const CONCEPTS = {
    'frontend-layout': {
        context: 'Vue application source lives under src/app, src/core, src/presentation, and src/shared. app owns composition and routing, core owns models and workflows, presentation owns device-specific Vue UI, and shared contains only non-visual assets, styles, and utilities.',
    },
    presentation: {
        context: 'Desktop, tablet, and mobile are separate presentation trees and never import each other. Every route composes one matching view from each tree. Breakpoints and device selection are owned centrally by app/presentation.ts, while presentation components contain only local responsive layout.',
    },
    'core-flow': {
        context: 'Frontend behavior flows Presentation -> Composable -> Service -> ApiClient -> Backend. Presentation never performs network access or imports API infrastructure. core/config exclusively reads import.meta.env, and state that survives presentation switches lives outside device components.',
    },
    styling: {
        context: 'Shared design tokens live in shared/styles. Bootstrap Sass is imported only by shared/styles/main.scss, complete Bootstrap JavaScript is imported only by main.ts, and Tabler Icons use the bundled webfont from the shared style entry. Presentation styles stay scoped and follow the repository unit contracts instead of introducing parallel frameworks or breakpoints.',
    },
    vue: {
        context: 'Vue components use <script setup lang="ts">, PascalCase component filenames, and scoped presentation styles. shared contains no reusable Vue components; visual components belong to exactly one device presentation.',
    },
    'tooling-failure': {
        context: 'The frontend linter must parse TypeScript, Vue SFCs, CSS, and SCSS before it can review their architecture. A fatal diagnostic means findings for the affected input or entire run are incomplete.',
    },
} as const satisfies Record<string, ArchitectureConcept>;

type ConceptId = keyof typeof CONCEPTS;
type Definition = RuleDefinition<ConceptId>;

const MEANINGS: Readonly<Record<ConceptId, string>> = {
    'frontend-layout': 'Ownership becomes ambiguous and application, workflow, and presentation code can no longer be changed independently.',
    presentation: 'Device presentations can drift, import each other, or switch inconsistently across viewport and routing behavior.',
    'core-flow': 'Transport and environment concerns leak into UI code, making workflows hard to test and state unsafe across presentation changes.',
    styling: 'The visual system becomes inconsistent, globally coupled, or dependent on unreviewed external assets and unit conventions.',
    vue: 'Component ownership, compilation behavior, or style isolation becomes inconsistent across the three presentations.',
    'tooling-failure': 'No trustworthy frontend architecture conclusion can be drawn for the affected source.',
};

function define(
    title: string,
    concept: ConceptId,
    why: string,
    fix: string,
): Definition {
    return {
        title,
        concept,
        why,
        meaning: MEANINGS[concept],
        fixSteps: [fix],
        verify: ['npm run lint --workspace @app/web'],
    };
}

const RULES = {
    AUTH_TOKEN_STORAGE_OWNERSHIP: define('Authentication tokens have one storage owner', 'core-flow', 'Token persistence is an authentication infrastructure concern, never presentation state.', 'Move token storage behind the approved core authentication service.'),
    CORE_LAYER_DIRECTION: define('A Core dependency points against the application flow', 'core-flow', 'Models, Services, Composables, and API infrastructure have one directed dependency chain.', 'Move the dependency to its owning Core layer or depend on the lower-level contract.'),
    CORE_STRUCTURE: define('The Core directory has an unsupported structure', 'frontend-layout', 'Core responsibilities use the declared model, service, composable, API, and configuration locations.', 'Move the file into the Core directory matching its responsibility.'),
    DESIGN_TOKEN_USAGE: define('Presentation styles must use shared design tokens', 'styling', 'Colors, font sizes, radii, and z-index values are centrally owned design decisions.', 'Replace the literal with the appropriate shared design token.'),
    FRONTEND_BOX_SPACING_UNIT: define('Box spacing uses a forbidden CSS unit', 'styling', 'Margin, padding, gap, and scroll spacing use px, %, unitless zero, or applicable semantic keywords.', 'Convert the value to an allowed spacing unit or shared token resolving to one.'),
    FRONTEND_ENV_OWNERSHIP: define('Environment access belongs to Core configuration', 'core-flow', 'import.meta.env is validated once and exposed as readonly application configuration.', 'Move environment access into core/config and consume its typed value.'),
    FRONTEND_FONT_SHORTHAND: define('Numeric font shorthand is forbidden', 'styling', 'Font shorthand can hide a font-size unit that the architecture contract cannot review reliably.', 'Set font-size separately in rem and use non-numeric font properties as needed.'),
    FRONTEND_FONT_SIZE_UNIT: define('Font sizes must use rem', 'styling', 'One scalable unit keeps typography consistent with user font preferences and shared tokens.', 'Convert the font-size to rem or use an allowed zero/reset value.'),
    FRONTEND_LAYER_DIRECTION: define('A frontend dependency crosses an ownership boundary', 'frontend-layout', 'app, core, presentation, and shared have distinct responsibilities and one permitted dependency direction.', 'Move the behavior to its owner or import through the permitted lower-level layer.'),
    FRONTEND_LINTER_FAILURE: define('The frontend architecture linter could not complete', 'tooling-failure', 'An unexpected tooling failure prevents a complete review.', 'Repair the reported linter failure before accepting frontend changes.'),
    FRONTEND_PARSE_ERROR: define('A frontend source file could not be parsed', 'tooling-failure', 'Architecture evidence requires syntactically valid TypeScript, Vue, CSS, and SCSS.', 'Repair the reported syntax error and rerun the linter.'),
    FRONTEND_SOURCE_PLACEMENT: define('Frontend source is outside an approved owner directory', 'frontend-layout', 'Every application source file belongs to app, core, presentation, or shared.', 'Move the file into the directory that owns its responsibility.'),
    BOOTSTRAP_CDN_FORBIDDEN: define('Bootstrap must not be loaded from a CDN', 'styling', 'The checked-in dependencies and Vite build define the reproducible Bootstrap version.', 'Remove the CDN reference and use the npm-owned Sass and JavaScript entrypoints.'),
    BOOTSTRAP_GLOBAL_SCRIPT_IMPORT_MISSING: define('The global Bootstrap JavaScript import is missing', 'styling', 'Complete Bootstrap JavaScript is initialized exactly once by the application entrypoint.', 'Import bootstrap for side effects in src/main.ts before mounting the Vue application.'),
    BOOTSTRAP_GLOBAL_STYLE_IMPORT_MISSING: define('The global Bootstrap Sass import is missing', 'styling', 'Bootstrap is the sole CSS framework and its Sass configuration has one global ownership point.', 'Import bootstrap/scss/bootstrap from shared/styles/main.scss after the approved Sass variables.'),
    BOOTSTRAP_OWNERSHIP: define('A Bootstrap import violates its global ownership contract', 'styling', 'Centralized, singular Sass and JavaScript entrypoints prevent duplicated framework state, partial plugin initialization, and conflicting configuration.', 'Keep exactly one bootstrap/scss/bootstrap import in shared/styles/main.scss and one complete bootstrap side-effect import in main.ts; remove every other Bootstrap import.'),
    PICO_REFERENCE_FORBIDDEN: define('A removed Pico styling contract remains', 'styling', 'Template 5 uses Bootstrap exclusively; Pico imports and variables create an unsupported second framework contract.', 'Remove the Pico import or variable and migrate the styling to Bootstrap or shared application tokens.'),
    PRESENTATION_BREAKPOINT_OWNERSHIP: define('Presentation breakpoints have one application owner', 'presentation', 'Device selection is centralized so components do not create a second presentation system.', 'Move breakpoint and device-selection logic into app/presentation.ts.'),
    PRESENTATION_CROSS_IMPORT: define('Device presentations must not import each other', 'presentation', 'Desktop, tablet, and mobile are independent implementations selected by the route adapter.', 'Move shared non-visual logic into Core or duplicate presentation-local UI behavior.'),
    PRESENTATION_MEDIA_QUERY: define('Width media queries must not select presentations', 'presentation', 'Presentation selection is owned by app/presentation.ts; local media queries may only refine layout.', 'Remove the presentation breakpoint and keep only local layout adaptation.'),
    PRESENTATION_NETWORK_ACCESS: define('Presentation code must not perform network access', 'core-flow', 'Network transport belongs to ApiClient and is reached through Service and Composable contracts.', 'Move the request into ApiClient/Service and expose it through a Composable.'),
    PRESENTATION_STRUCTURE: define('The presentation tree has an unsupported structure', 'presentation', 'Each device tree uses matching view, layout, and presentation-local component ownership.', 'Move the file into the matching desktop, tablet, or mobile structure.'),
    PRESENTATION_STYLE_SCOPE: define('Presentation component styles must be scoped', 'vue', 'Device-local styles must not leak into other presentations or global application UI.', 'Add scoped to the presentation component style block.'),
    PRESENTATION_VIEW_PARITY: define('Device presentations are missing matching views', 'presentation', 'Every route-capable view exists in desktop, tablet, and mobile forms.', 'Create the missing matching views, preferably through scaffold:route.'),
    ROUTER_OWNERSHIP: define('The shared router has one application owner', 'frontend-layout', 'Route composition belongs exclusively to src/app/router.ts.', 'Move router construction and route registration into app/router.ts.'),
    ROUTE_PRESENTATION_COVERAGE: define('A route does not compose all three presentations', 'presentation', 'Each route adapter selects exactly one desktop, tablet, and mobile view.', 'Add the missing presentation views to the route adapter.'),
    SHARED_VUE_COMPONENT: define('Shared must not contain Vue components', 'vue', 'Visual components belong to one device presentation rather than a cross-device shared UI layer.', 'Move the component into the owning presentation and keep only non-visual utilities in shared.'),
    TABLER_ICON_CDN_FORBIDDEN: define('Tabler Icons must not be loaded from a CDN', 'styling', 'The bundled pinned webfont is the reproducible icon source.', 'Remove the CDN reference and use the bundled stylesheet from shared/styles/main.scss.'),
    TABLER_ICON_GLOBAL_IMPORT_MISSING: define('The bundled Tabler icon import is missing', 'styling', 'The icon webfont has one global ownership point alongside shared styles.', 'Import the bundled Tabler stylesheet from shared/styles/main.scss.'),
    TABLER_ICON_OWNERSHIP: define('Tabler Icons are imported outside shared styles', 'styling', 'Presentation code consumes ti classes without owning global font CSS.', 'Remove the local import and rely on shared/styles/main.scss.'),
    VUE_COMPONENT_NAME: define('Vue component filenames must be PascalCase', 'vue', 'Deterministic component names distinguish components from views and generated route artifacts.', 'Rename the component file to PascalCase while preserving its architecture suffix when required.'),
    VUE_SCRIPT_SETUP: define('Vue components require script setup with TypeScript', 'vue', 'The project uses one explicit Vue component compilation contract.', 'Use exactly <script setup lang="ts"> and remove a parallel normal script block.'),
} as const satisfies Record<string, Definition>;

export type FrontendRuleId = keyof typeof RULES;

/** Owns complete self-contained teaching material for frontend rules. */
export class RuleCatalog extends DiagnosticCatalog<FrontendRuleId, ConceptId> {
    public constructor() {
        super(CONCEPTS, RULES);
    }
}
