export interface TemplateMetadata {
    readonly version: string;
    readonly repository: string;
}

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
    readonly relativePath: string;
    readonly reason: string;
    readonly basePath?: string;
    readonly localPath?: string;
    readonly incomingPath?: string;
}

export interface UpdatePlan {
    readonly actions: readonly UpdateAction[];
    readonly conflicts: readonly UpdateConflict[];
}
