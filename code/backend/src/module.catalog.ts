import type { ModuleDefinitions } from './base/interfaces.ts';
import { AuthModule } from './module/auth/index.ts';
import { HealthModule } from './module/health/index.ts';

/** Registered module factories keyed by their stable configuration names. */
export const moduleDefinitions: ModuleDefinitions = {
    [AuthModule.definition.name]: AuthModule.definition,
    [HealthModule.definition.name]: HealthModule.definition,
};
