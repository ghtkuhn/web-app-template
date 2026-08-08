/** Safe authenticated user state exposed to Presentation code. */
export interface AuthModel {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly image: string | null;
    readonly expiresAt: Date;
}
