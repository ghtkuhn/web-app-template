/** Read-only system color-scheme source used by the Bootstrap theme bridge. */
export interface ColorSchemeSource {
    isDark(): boolean;
    subscribe(listener: () => void): () => void;
}

/** Minimal document root contract needed to set Bootstrap's color mode. */
export interface BootstrapThemeRoot {
    readonly dataset: {
        bsTheme?: string;
    };
}

/** Adapts matchMedia to a deterministic, testable color-scheme source. */
export class SystemColorSchemeSource implements ColorSchemeSource {
    private readonly query: MediaQueryList;

    public constructor(matchMedia: Window['matchMedia']) {
        this.query = matchMedia('(prefers-color-scheme: dark)');
    }

    public isDark(): boolean {
        return this.query.matches;
    }

    public subscribe(listener: () => void): () => void {
        this.query.addEventListener('change', listener);
        return () => this.query.removeEventListener('change', listener);
    }
}

/** Keeps Bootstrap's data-bs-theme synchronized with the system preference. */
export class BootstrapColorModeController {
    private readonly root: BootstrapThemeRoot;
    private readonly source: ColorSchemeSource | null;
    private unsubscribe: (() => void) | null = null;

    public constructor(
        root: BootstrapThemeRoot,
        source: ColorSchemeSource | null,
    ) {
        this.root = root;
        this.source = source;
    }

    public start(): void {
        this.stop();
        this.apply();
        this.unsubscribe = this.source?.subscribe(() => this.apply()) ?? null;
    }

    public stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    private apply(): void {
        this.root.dataset.bsTheme = this.source?.isDark() ? 'dark' : 'light';
    }
}
