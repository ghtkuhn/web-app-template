import type { ApiError, ApiResult } from '../api/interfaces.ts';
import type { FrontendAuthClient } from '../api/auth.client.ts';
import { authTokenStore } from '../api/auth-token.store.ts';
import type { AuthModel } from '../models/auth.model.ts';

/** Maps Better Auth transport results to stable frontend Auth models. */
export class AuthService {
    /** Receives the configured Better Auth transport. */
    public constructor(private readonly authClient: FrontendAuthClient) {}

    /** Restores the current signed Bearer session. */
    public async getSession(): Promise<ApiResult<AuthModel | null>> {
        const result = await this.authClient.getSession();
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
        const result = await this.authClient.signIn.email({ email, password });
        return result.error
            ? { success: false, error: this.error(result.error) }
            : this.getSession();
    }

    /** Registers an Email/password account when enabled by runtime config. */
    public async signUp(
        name: string,
        email: string,
        password: string,
    ): Promise<ApiResult<AuthModel | null>> {
        const result = await this.authClient.signUp.email({ name, email, password });
        return result.error
            ? { success: false, error: this.error(result.error) }
            : this.getSession();
    }

    /** Invalidates the current session and always clears local credentials. */
    public async signOut(): Promise<ApiResult<null>> {
        const result = await this.authClient.signOut();
        authTokenStore.clear();
        return result.error
            ? { success: false, error: this.error(result.error) }
            : { success: true, data: null };
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
    private error(error: { message?: string; status?: number }): ApiError {
        return {
            type: 'http',
            status: error.status ?? 400,
            message: error.message ?? 'Authentication failed.',
        };
    }
}
