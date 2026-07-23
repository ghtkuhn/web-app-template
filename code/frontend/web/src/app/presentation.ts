import {
    inject,
    readonly,
    ref,
    type InjectionKey,
    type Ref,
} from 'vue';
import type { Presentation } from '../core/config/interfaces.ts';

export interface Viewport {
    innerWidth: number;
    addEventListener(type: 'resize', listener: () => void): void;
    removeEventListener(type: 'resize', listener: () => void): void;
}

export interface DeviceHints {
    userAgentData?: {
        mobile: boolean;
    };
}

const MOBILE_MAX_WIDTH = 767;
const TABLET_MAX_WIDTH = 1199;

export const PRESENTATION_KEY: InjectionKey<Readonly<Ref<Presentation>>> =
    Symbol('presentation');

/** Maintains the active presentation for one browser viewport. */
export class PresentationController {
    private readonly viewport: Viewport;
    private readonly activePresentation: Ref<Presentation>;
    private readonly lockedPresentation: Presentation | null;
    private started = false;

    /** Creates a stopped controller initialized from the current viewport. */
    constructor(
        viewport: Viewport,
        lockedPresentation: Presentation | null = null,
    ) {
        this.viewport = viewport;
        this.lockedPresentation = lockedPresentation;
        this.activePresentation = ref(
            lockedPresentation ??
                PresentationController.resolve(viewport.innerWidth),
        );
    }

    /** Read-only reactive presentation exposed to the Vue component tree. */
    public get presentation(): Readonly<Ref<Presentation>> {
        return readonly(this.activePresentation);
    }

    /** Maps one viewport width to its presentation category. */
    public static resolve(width: number): Presentation {
        if (width <= MOBILE_MAX_WIDTH) {
            return 'mobile';
        }
        if (width <= TABLET_MAX_WIDTH) {
            return 'tablet';
        }
        return 'desktop';
    }

    /** Returns an explicit lock or a standardized, unambiguous device hint. */
    public static detectDevice(
        hints: DeviceHints,
        explicitPresentation?: string,
    ): Presentation | null {
        if (
            explicitPresentation &&
            ['desktop', 'tablet', 'mobile'].includes(explicitPresentation)
        ) {
            return explicitPresentation as Presentation;
        }
        return hints.userAgentData?.mobile === true ? 'mobile' : null;
    }

    /** Starts observing live viewport changes exactly once. */
    public start(): void {
        if (this.started || this.lockedPresentation) {
            return;
        }
        this.started = true;
        this.viewport.addEventListener('resize', this.handleResize);
    }

    /** Stops observing viewport changes. */
    public stop(): void {
        if (!this.started) {
            return;
        }
        this.started = false;
        this.viewport.removeEventListener('resize', this.handleResize);
    }

    private readonly handleResize = (): void => {
        this.activePresentation.value = PresentationController.resolve(
            this.viewport.innerWidth,
        );
    };
}

/** Returns the presentation provided by the application composition root. */
export function usePresentation(): Readonly<Ref<Presentation>> {
    const presentation = inject(PRESENTATION_KEY);
    if (!presentation) {
        throw new Error('Presentation state was not provided.');
    }
    return presentation;
}
