/** Owns the browser-readable Bearer token for the current tab. */
export class AuthTokenStore {
    private readonly key = 'web-app.auth.bearer';

    /** Returns the current token without exposing the Storage API. */
    public get(): string | null {
        return sessionStorage.getItem(this.key);
    }

    /** Replaces the current token after successful authentication. */
    public set(token: string): void {
        sessionStorage.setItem(this.key, token);
    }

    /** Removes credentials after logout or invalid session detection. */
    public clear(): void {
        sessionStorage.removeItem(this.key);
    }
}

/** Single token owner shared by Auth and normal API transports. */
export const authTokenStore = new AuthTokenStore();
