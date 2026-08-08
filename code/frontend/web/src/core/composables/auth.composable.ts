import { readonly, ref, type Ref } from 'vue';
import type { ApiError } from '../api/interfaces.ts';
import { createFrontendAuthClient } from '../api/auth.client.ts';
import { frontendConfig } from '../config/frontend.config.ts';
import type { AuthModel } from '../models/auth.model.ts';
import { AuthService } from '../services/auth.service.ts';
import type { AsyncState, AsyncStatus } from './interfaces.ts';

/** Persistent authentication state shared by all three Presentations. */
export class AuthComposable implements AsyncState<AuthModel> {
    private readonly mutableStatus: Ref<AsyncStatus> = ref('idle');
    private readonly mutableData: Ref<AuthModel | null> = ref(null);
    private readonly mutableError: Ref<ApiError | null> = ref(null);

    public readonly status = readonly(this.mutableStatus);
    public readonly data = readonly(this.mutableData);
    public readonly error = readonly(this.mutableError);

    /** Receives Auth behavior and validated feature switches. */
    public constructor(
        private readonly service: AuthService,
        public readonly enabled: boolean,
        public readonly registrationEnabled: boolean,
    ) {}

    /** Restores a session once without sending requests when Auth is disabled. */
    public async restore(): Promise<void> {
        if (!this.enabled) {
            this.mutableStatus.value = 'success';
            return;
        }
        await this.run(() => this.service.getSession());
    }

    /** Authenticates one Email/password credential pair. */
    public async signIn(email: string, password: string): Promise<void> {
        await this.run(() => this.service.signIn(email, password));
    }

    /** Registers an account only when public registration is enabled. */
    public async signUp(
        name: string,
        email: string,
        password: string,
    ): Promise<void> {
        if (!this.registrationEnabled) {
            this.mutableStatus.value = 'error';
            this.mutableError.value = {
                type: 'http',
                status: 403,
                message: 'Registration is not available.',
            };
            return;
        }
        await this.run(() => this.service.signUp(name, email, password));
    }

    /** Signs out and clears the shared session state. */
    public async signOut(): Promise<void> {
        this.mutableStatus.value = 'loading';
        const result = await this.service.signOut();
        this.mutableData.value = null;
        this.mutableError.value = result.success ? null : result.error;
        this.mutableStatus.value = result.success ? 'success' : 'error';
    }

    /** Applies one Auth result to the shared async state. */
    private async run(
        operation: () => ReturnType<AuthService['getSession']>,
    ): Promise<void> {
        this.mutableStatus.value = 'loading';
        this.mutableError.value = null;
        const result = await operation();
        this.mutableData.value = result.success ? result.data : null;
        this.mutableError.value = result.success ? null : result.error;
        this.mutableStatus.value = result.success ? 'success' : 'error';
    }
}

/** Shared Auth composable whose state survives Presentation remounts. */
export const authComposable = new AuthComposable(
    new AuthService(createFrontendAuthClient(frontendConfig.apiBaseUrl)),
    frontendConfig.authEnabled,
    frontendConfig.registrationEnabled,
);
