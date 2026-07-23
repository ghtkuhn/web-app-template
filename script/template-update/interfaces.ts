export interface TemplateMetadata {
    readonly version: string;
    readonly repository: string;
}

export type ConflictResolution =
    | 'unresolved'
    | 'local'
    | 'incoming'
    | 'merged'
    | 'delete';

export interface TemplateRelease {
    readonly version: string;
    readonly tag: string;
    readonly archiveUrl: string;
}

export type UpdateAction =
    | {
          readonly kind: 'write';
          readonly relativePath: string;
          readonly sourcePath: string;
          readonly mode: number;
      }
    | {
          readonly kind: 'delete';
          readonly relativePath: string;
      };

export interface UpdateConflict {
    readonly id?: string;
    readonly relativePath: string;
    readonly reason: string;
    readonly basePath?: string;
    readonly localPath?: string;
    readonly incomingPath?: string;
}

export interface ConflictFingerprint {
    readonly id: string;
    readonly path: string;
    readonly reason: string;
    readonly baseHash: string | null;
    readonly localHash: string | null;
    readonly incomingHash: string | null;
}

export interface ConflictSession {
    readonly schemaVersion: 1;
    readonly repository: string;
    readonly fromVersion: string;
    readonly targetVersion: string;
    readonly conflicts: readonly ConflictFingerprint[];
}

export interface VerificationStatus {
    readonly schemaVersion: 1;
    readonly version: string;
    readonly verification: 'passed' | 'failed';
    readonly logPath: string;
}

export interface UpdateExecutionResult {
    readonly verificationPassed: boolean;
    readonly logPath: string;
}

export interface UpdatePlan {
    readonly actions: readonly UpdateAction[];
    readonly conflicts: readonly UpdateConflict[];
}
