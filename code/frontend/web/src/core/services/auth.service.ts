import type { ApiError, ApiResult } from '../api/interfaces.ts';
import { toTransportApiError } from '../api/api-error.ts';
import type { FrontendAuthClient } from '../api/auth.client.ts';
import { authTokenStore } from '../api/auth-token.store.ts';
import type { AuthModel } from '../models/auth.model.ts';

interface AuthClientError {
    readonly message?: string;
    readonly status?: number;
}

interface AuthClientResult {
    readonly error: AuthClientError | null;
}

/** Maps Better Auth transport results to stable frontend Auth models. */
export class AuthService {
    /** Receives the configured Better Auth transport. */
    public constructor(private readonly authClient: FrontendAuthClient) {}

    /** Restores the current signed Bearer session. */
    public async getSession(): Promise<ApiResult<AuthModel | null>> {
        const transport = await this.captureTransport(
            () => this.authClient.getSession(),
        );
        if (!transport.success) {
            authTokenStore.clear();
            return transport;
        }
        const result = transport.data;
        if (result.error) {
            authTokenStore.clear();
            return { success: false, error: this.error(result.error) };
        }
        if (!result.data) {
            authTokenStore.clear();
            return { success: true, data: null };
        }
        return { success: true, data: this.model(result.data) };
    }

    /** Signs in with Email and password, then returns the active session. */
    public async signIn(
        email: string,
        password: string,
    ): Promise<ApiResult<AuthModel | null>> {
        return this.authenticate(
            () => this.authClient.signIn.email({ email, password }),
        );
    }

    /** Registers an Email/password account when enabled by runtime config. */
    public async signUp(
        name: string,
        email: string,
        password: string,
    ): Promise<ApiResult<AuthModel | null>> {
        return this.authenticate(
            () => this.authClient.signUp.email({ name, email, password }),
        );
    }

    /** Invalidates the current session and always clears local credentials. */
    public async signOut(): Promise<ApiResult<null>> {
        try {
            const transport = await this.captureTransport(
                () => this.authClient.signOut(),
            );
            if (!transport.success) {
                return transport;
            }
            return transport.data.error
                ? { success: false, error: this.error(transport.data.error) }
                : { success: true, data: null };
        } finally {
            authTokenStore.clear();
        }
    }

    /** Maps Better Auth session data without exposing its session token. */
    private model(data: {
        user: {
            id: string;
            name: string;
            email: string;
            emailVerified: boolean;
            image?: string | null;
        };
        session: { expiresAt: Date };
    }): AuthModel {
        return {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            emailVerified: data.user.emailVerified,
            image: data.user.image ?? null,
            expiresAt: data.session.expiresAt,
        };
    }

    /** Normalizes Better Auth client errors. */
    private error(error: AuthClientError): ApiError {
        return {
            type: 'http',
            status: error.status ?? 400,
            message: error.message ?? 'Authentication failed.',
        };
    }

    /** Completes one credential exchange with a freshly restored session. */
    private async authenticate(
        operation: () => Promise<AuthClientResult>,
    ): Promise<ApiResult<AuthModel | null>> {
        const transport = await this.captureTransport(operation);
        if (!transport.success) {
            return transport;
        }
        return transport.data.error
            ? { success: false, error: this.error(transport.data.error) }
            : this.getSession();
    }

    /** Captures only transport invocation failures at the service boundary. */
    private async captureTransport<T>(
        operation: () => Promise<T>,
    ): Promise<ApiResult<T>> {
        try {
            return { success: true, data: await operation() };
        } catch (error) {
            return {
                success: false,
                error: toTransportApiError(error),
            };
        }
    }
}
