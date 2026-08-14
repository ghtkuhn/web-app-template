export type ComponentName = 'backend' | 'frontend';
export type ComponentSelection = ComponentName | 'all';
export type DeploymentEnvironment = 'local' | 'dev' | 'staging' | 'prod';

export interface DockerTarget {
    readonly driver: 'docker';
    readonly image: string;
    readonly hostPort: number;
}

export interface ProxmoxLxcTarget {
    readonly driver: 'proxmox-lxc';
    readonly apiUrl: string;
    readonly node: string;
    readonly vmid: number;
    readonly hostname: string;
    readonly storage: string;
    readonly template: string;
    readonly bridge: string;
    readonly address: string;
    readonly gateway: string;
    readonly nameserver: string;
    readonly firewall: boolean;
    readonly startOnBoot: boolean;
    readonly stopContainer: boolean;
    readonly sshHost: string;
    readonly sshUser: string;
    readonly sshPublicKey: string;
    readonly cores: number;
    readonly memoryMb: number;
    readonly swapMb: number;
    readonly diskGb: number;
    readonly allowInsecureTls?: boolean;
}

export type DeploymentTarget = DockerTarget | ProxmoxLxcTarget;

export interface SqliteDeploymentDatabase {
    readonly type: 'sqlite';
    readonly path: string;
    readonly backupRetention: number;
}

export interface PostgresDeploymentDatabase {
    readonly type: 'postgres';
    readonly connectionUrlSecret: 'DATABASE_URL';
    readonly backupStrategy: 'external';
    readonly poolMax?: number;
    readonly idleTimeoutMs?: number;
    readonly connectionTimeoutMs?: number;
}

export type DeploymentDatabase =
    | SqliteDeploymentDatabase
    | PostgresDeploymentDatabase;

export interface BackendDeployment {
    readonly enabled: true;
    readonly target: DeploymentTarget;
    readonly publicHttpUrl: string;
    readonly publicWebSocketUrl: string;
    readonly allowedOrigins: readonly string[];
    readonly activeModules: readonly string[];
    readonly authRegistrationEnabled: boolean;
    readonly database: DeploymentDatabase;
}

export interface FrontendDeployment {
    readonly enabled: true;
    readonly target: DeploymentTarget;
    readonly publicUrl: string;
    readonly runtime: {
        readonly apiBaseUrl: string;
        readonly webSocketUrl: string;
        readonly presentationLock: 'desktop' | 'tablet' | 'mobile' | null;
        readonly authEnabled: boolean;
        readonly registrationEnabled: boolean;
    };
}

export interface DisabledDeployment {
    readonly enabled: false;
}

export interface DeploymentProfile {
    readonly schemaVersion: 2;
    readonly name: string;
    readonly environment: DeploymentEnvironment;
    readonly requiredSecrets: readonly string[];
    readonly backend: BackendDeployment | DisabledDeployment;
    readonly frontend: FrontendDeployment | DisabledDeployment;
}
