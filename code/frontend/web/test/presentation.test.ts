import { expect, test } from 'vitest';
import {
    PresentationController,
    type Viewport,
} from '../src/app/presentation.ts';

/** Mutable viewport used to exercise resize behavior without a browser. */
class TestViewport implements Viewport {
    public innerWidth: number;
    private listener: (() => void) | null = null;

    constructor(width: number) {
        this.innerWidth = width;
    }

    public addEventListener(
        _type: 'resize',
        listener: () => void,
    ): void {
        this.listener = listener;
    }

    public removeEventListener(
        _type: 'resize',
        listener: () => void,
    ): void {
        if (this.listener === listener) {
            this.listener = null;
        }
    }

    public resize(width: number): void {
        this.innerWidth = width;
        this.listener?.();
    }

    public hasListener(): boolean {
        return this.listener !== null;
    }
}

test('presentation boundaries map to mobile, tablet, and desktop', () => {
    expect(PresentationController.resolve(767)).toBe('mobile');
    expect(PresentationController.resolve(768)).toBe('tablet');
    expect(PresentationController.resolve(1199)).toBe('tablet');
    expect(PresentationController.resolve(1200)).toBe('desktop');
});

test('uncertain devices switch presentation live with the viewport', () => {
    const viewport = new TestViewport(500);
    const controller = new PresentationController(viewport);
    controller.start();

    expect(controller.presentation.value).toBe('mobile');
    viewport.resize(900);
    expect(controller.presentation.value).toBe('tablet');
    viewport.resize(1400);
    expect(controller.presentation.value).toBe('desktop');

    controller.stop();
    expect(viewport.hasListener()).toBe(false);
});

test('confident device detection locks the presentation', () => {
    expect(
        PresentationController.detectDevice({}, 'tablet'),
    ).toBe('tablet');
    expect(
        PresentationController.detectDevice({}, 'desktop'),
    ).toBe('desktop');
    expect(
        PresentationController.detectDevice({
            userAgentData: { mobile: true },
        }),
    ).toBe('mobile');
    expect(
        PresentationController.detectDevice({
            userAgentData: { mobile: false },
        }),
    ).toBeNull();

    const viewport = new TestViewport(1400);
    const controller = new PresentationController(viewport, 'mobile');
    controller.start();
    viewport.resize(900);

    expect(controller.presentation.value).toBe('mobile');
    expect(viewport.hasListener()).toBe(false);
});
