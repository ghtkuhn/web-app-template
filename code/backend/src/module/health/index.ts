import { BaseModule } from '../../base/base.module.ts';
import { HEALTH_MODULE_NAME } from './constants.ts';
import { HealthCliHandler } from './api/health.cli.handler.ts';
import { HealthHttpHandler } from './api/health.http.handler.ts';
import { HealthNodeHandler } from './api/health.node.handler.ts';
import { HealthWebSocketHandler } from './api/health.websocket.handler.ts';
import { HealthController } from './controller/health.controller.ts';
import type { HealthStatusDTO } from './dto/health-status.dto.ts';
import { HealthService } from './service/health.service.ts';
import type { NamedModuleDefinition } from '../../base/interfaces.ts';
import type { HealthModulePort } from './interfaces.ts';
import type { HealthNodeRequest } from './types.ts';

export { HealthStatusDTO } from './dto/health-status.dto.ts';
export { HEALTH_MODULE_NAME } from './constants.ts';
export type { HealthModulePort } from './interfaces.ts';
export type { HealthNodeRequest } from './types.ts';

/**
 * Public gateway for the health domain.
 * Registers the HTTP adapter while keeping its internal layers encapsulated.
 */
export class HealthModule
    extends BaseModule<HealthNodeRequest, HealthStatusDTO>
    implements HealthModulePort
{
    /** Durable registry metadata consumed by the generated module catalog. */
    public static readonly definition = {
        name: HEALTH_MODULE_NAME,
        dependencies: [],
        create: () => new HealthModule(),
    } satisfies NamedModuleDefinition;

    /** Creates the stateless health dependency chain. */
    constructor() {
        super();
        const controller = new HealthController(new HealthService());
        this.registerHandler('http', new HealthHttpHandler(controller));
        this.registerHandler(
            'websocket',
            new HealthWebSocketHandler(controller),
        );
        this.registerHandler('cli', new HealthCliHandler(controller));
        this.registerHandler('node', new HealthNodeHandler(controller));
    }
}
