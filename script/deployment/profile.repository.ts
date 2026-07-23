import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { DeploymentProfile } from './interfaces.ts';

/** Loads, validates, and safely scaffolds deployment profiles. */
export class DeploymentProfileRepository {
    private readonly profilesRoot: string;
    private readonly validateProfile;
    private readonly projectRoot: string;

    public constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.profilesRoot = path.join(projectRoot, 'deployment/profiles');
        const schema = JSON.parse(fs.readFileSync(
            path.join(projectRoot, 'deployment/profile.schema.json'),
            'utf8',
        ));
        this.validateProfile = new Ajv2020({
            allErrors: true,
            strict: true,
            formats: {
                uri: {
                    type: 'string',
                    validate: (value: string) => {
                        try {
                            new URL(value);
                            return true;
                        } catch {
                            return false;
                        }
                    },
                },
            },
        }).compile(schema);
    }

    /** Loads a named profile or local when omitted. */
    public load(name = 'local'): DeploymentProfile {
        this.assertName(name);
        const versionedPath = path.join(this.profilesRoot, `${name}.json`);
        const localPath = path.join(
            this.profilesRoot,
            `${name}.local.json`,
        );
        const filePath = fs.existsSync(versionedPath)
            ? versionedPath
            : localPath;
        const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!this.validateProfile(profile)) {
            throw new Error(
                `Invalid deployment profile '${name}': ${this.validateProfile.errors?.map((error) => error.message).join(', ')}`,
            );
        }
        this.assertSecurity(profile as DeploymentProfile);
        return profile as DeploymentProfile;
    }

    /** Loads every checked-in profile in deterministic name order. */
    public loadAll(): readonly DeploymentProfile[] {
        return fs.readdirSync(this.profilesRoot)
            .filter(
                (name) =>
                    name.endsWith('.json') &&
                    !name.endsWith('.local.json'),
            )
            .sort()
            .map((name) => this.load(name.slice(0, -5)));
    }

    /** Creates a new profile using Docker unless drivers are explicit. */
    public scaffold(
        name: string,
        sourceName = 'local',
        backendDriver?: string,
        frontendDriver?: string,
    ): string {
        this.assertName(name);
        const target = path.join(this.profilesRoot, `${name}.json`);
        if (fs.existsSync(target)) {
            throw new Error(`Deployment profile '${name}' already exists.`);
        }
        const profile = structuredClone(this.load(sourceName)) as any;
        profile.name = name;
        profile.environment = ['local', 'dev', 'staging', 'prod'].includes(name)
            ? name
            : 'dev';
        this.applyDriver(profile, 'backend', backendDriver ?? 'docker');
        this.applyDriver(profile, 'frontend', frontendDriver ?? 'docker');
        if (!this.validateProfile(profile)) {
            throw new Error(
                `Generated deployment profile is invalid: ${this.validateProfile.errors?.map((error) => error.message).join(', ')}`,
            );
        }
        this.assertSecurity(profile as DeploymentProfile);
        fs.writeFileSync(target, `${JSON.stringify(profile, null, 4)}\n`);
        return target;
    }

    private applyDriver(
        profile: DeploymentProfile,
        component: 'backend' | 'frontend',
        driver: string,
    ): void {
        if (!['docker', 'proxmox-lxc'].includes(driver)) {
            throw new Error(`Unknown deployment driver '${driver}'.`);
        }
        const selected = profile[component] as any;
        if (selected.enabled) {
            selected.target = driver === 'docker'
                ? {
                      driver: 'docker',
                      image: `web-app-${component}:${profile.name}`,
                      hostPort: component === 'backend' ? 3000 : 8080,
                  }
                : {
                      driver: 'proxmox-lxc',
                      apiUrl: 'https://proxmox.local:8006',
                      node: 'pve',
                      vmid: component === 'backend' ? 200 : 201,
                      hostname: `web-app-${component}`,
                      storage: 'local-lvm',
                      template:
                          'local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst',
                      bridge: 'vmbr0',
                      address: 'dhcp',
                      gateway: '192.168.1.1',
                      nameserver: '1.1.1.1',
                      firewall: true,
                      startOnBoot: true,
                      stopContainer: true,
                      sshHost: `${component}.local`,
                      sshUser: 'root',
                      sshPublicKey: 'replace-with-public-key',
                      cores: 2,
                      memoryMb: component === 'backend' ? 1024 : 512,
                      swapMb: 512,
                      diskGb: 8,
                      allowInsecureTls:
                          profile.environment === 'local' ||
                          profile.environment === 'dev',
                  };
        }
    }

    private assertSecurity(profile: DeploymentProfile): void {
        const serialized = JSON.stringify(profile).toLowerCase();
        for (const forbidden of ['password', 'privatekey', 'tokensecret']) {
            if (serialized.includes(`"${forbidden}"`)) {
                throw new Error(`Profiles must not contain '${forbidden}'.`);
            }
        }
        if (
            profile.environment !== 'local' &&
            profile.environment !== 'dev'
        ) {
            for (const component of [profile.backend, profile.frontend]) {
                if (
                    component.enabled &&
                    component.target.driver === 'proxmox-lxc' &&
                    component.target.allowInsecureTls
                ) {
                    throw new Error(
                        `${profile.environment} profiles require verified Proxmox TLS.`,
                    );
                }
            }
        }
    }

    private assertName(name: string): void {
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
            throw new Error(`Invalid deployment profile name '${name}'.`);
        }
    }
}
