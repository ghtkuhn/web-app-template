import type { ModuleDefinitions } from './base/interfaces.ts';
import { HealthModule } from './module/health/index.ts';

/** Registered module factories keyed by their stable configuration names. */
export const moduleDefinitions: ModuleDefinitions = {
    [HealthModule.definition.name]: HealthModule.definition,
};
