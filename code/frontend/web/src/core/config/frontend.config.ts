import type {
    FrontendRuntimeConfig,
    Presentation,
} from './interfaces.ts';

export interface FrontendEnvironment {
    readonly BASE_URL?: string;
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_PRESENTATION_LOCK?: string;
}

/** Validated runtime configuration owned by the frontend composition layer. */
export class FrontendConfig {
    public readonly apiBaseUrl: string;
    public readonly routerBaseUrl: string;
    public readonly presentationLock: Presentation | null;
    public readonly webSocketUrl: string;

    private constructor(
        apiBaseUrl: string,
        routerBaseUrl: string,
        presentationLock: Presentation | null,
        webSocketUrl: string,
    ) {
        this.apiBaseUrl = apiBaseUrl;
        this.routerBaseUrl = routerBaseUrl;
        this.presentationLock = presentationLock;
        this.webSocketUrl = webSocketUrl;
    }

    /** Creates validated configuration from Vite environment values. */
    public static fromEnvironment(
        environment: FrontendEnvironment,
        runtime: FrontendRuntimeConfig | undefined =
            typeof window === 'undefined'
                ? undefined
                : window.__APP_CONFIG__,
    ): FrontendConfig {
        const apiBaseUrl =
            runtime?.apiBaseUrl ?? environment.VITE_API_BASE_URL ?? '/';
        const routerBaseUrl = environment.BASE_URL ?? '/';
        const presentationLock = this.parsePresentation(
            runtime?.presentationLock ??
                environment.VITE_PRESENTATION_LOCK,
        );
        const webSocketUrl =
            runtime?.webSocketUrl ?? 'ws://localhost:3001';

        this.assertUrl(apiBaseUrl, 'VITE_API_BASE_URL');
        this.assertUrl(webSocketUrl, 'webSocketUrl');
        this.assertPath(routerBaseUrl, 'BASE_URL');
        return new FrontendConfig(
            apiBaseUrl,
            routerBaseUrl,
            presentationLock,
            webSocketUrl,
        );
    }

    private static parsePresentation(
        value: string | undefined,
    ): Presentation | null {
        if (!value) {
            return null;
        }
        if (['desktop', 'tablet', 'mobile'].includes(value)) {
            return value as Presentation;
        }
        throw new Error(
            `Invalid VITE_PRESENTATION_LOCK '${value}'. Expected desktop, tablet, or mobile.`,
        );
    }

    private static assertUrl(value: string, name: string): void {
        try {
            new URL(value, 'http://frontend.local');
        } catch {
            throw new Error(`Invalid ${name} '${value}'.`);
        }
    }

    private static assertPath(value: string, name: string): void {
        if (!value.startsWith('/')) {
            throw new Error(`${name} must start with '/'.`);
        }
    }
}

/** Single validated application configuration. */
export const frontendConfig = FrontendConfig.fromEnvironment(import.meta.env);
