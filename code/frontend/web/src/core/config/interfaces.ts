export type Presentation = 'desktop' | 'tablet' | 'mobile';

export interface FrontendRuntimeConfig {
    readonly apiBaseUrl: string;
    readonly webSocketUrl: string;
    readonly presentationLock: Presentation | null;
}

declare global {
    interface Window {
        __APP_CONFIG__?: FrontendRuntimeConfig;
    }
}
