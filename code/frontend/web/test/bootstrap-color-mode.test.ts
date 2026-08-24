import { expect, test } from 'vitest';
import {
    BootstrapColorModeController,
    type BootstrapThemeRoot,
    type ColorSchemeSource,
} from '../src/app/bootstrap-color-mode.ts';

/** Mutable color-scheme source used to verify live system changes. */
class TestColorSchemeSource implements ColorSchemeSource {
    private dark: boolean;
    private listener: (() => void) | null = null;

    public constructor(dark: boolean) {
        this.dark = dark;
    }

    public isDark(): boolean {
        return this.dark;
    }

    public subscribe(listener: () => void): () => void {
        this.listener = listener;
        return () => {
            if (this.listener === listener) {
                this.listener = null;
            }
        };
    }

    public change(dark: boolean): void {
        this.dark = dark;
        this.listener?.();
    }
}

function themeRoot(): BootstrapThemeRoot {
    return { dataset: {} };
}

test('Bootstrap color mode follows the initial system preference and changes', () => {
    const root = themeRoot();
    const source = new TestColorSchemeSource(true);
    const controller = new BootstrapColorModeController(root, source);

    controller.start();
    expect(root.dataset.bsTheme).toBe('dark');

    source.change(false);
    expect(root.dataset.bsTheme).toBe('light');

    controller.stop();
    source.change(true);
    expect(root.dataset.bsTheme).toBe('light');
});

test('Bootstrap color mode falls back to light without matchMedia', () => {
    const root = themeRoot();

    new BootstrapColorModeController(root, null).start();

    expect(root.dataset.bsTheme).toBe('light');
});
