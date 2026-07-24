import type { IBaseDTO, IEntityDTO } from './interfaces.ts';
import { BaseObject } from './base.object.ts';
import { v4 as uuidv4 } from 'uuid';

/**
 * BaseDTO defines transported application data at backend boundaries.
 *
 * RESPONSIBILITIES:
 * - Act as a filtered view of Domain Objects to prevent leaking sensitive internal state.
 * - Provide explicit request and response contracts for supported transports.
 *
 * IMPORT RULES:
 * - ALLOWED: Basic TypeScript types, Base classes.
 * - FORBIDDEN: Handlers, Controllers, Services, Stores, database drivers.
 *
 * CONSTRAINTS:
 * - Must NOT contain business logic or database access code.
 */
export abstract class BaseDTO implements IBaseDTO {
    /**
     * Assigns already validated DTO properties.
     *
     * @param data Initial DTO values.
     */
    constructor(data?: Partial<BaseDTO>) {
        if (data) {
            Object.assign(this, data);
        }
    }
}

/**
 * Base for DTOs that carry the public identity of a domain entity.
 *
 * The conversion methods are primitives invoked by Services; Services retain
 * ownership of mapping decisions and transported field selection.
 */
export abstract class EntityDTO<T extends BaseObject>
    extends BaseDTO
    implements IEntityDTO<T>
{
    /** Public identity of the mapped domain entity. */
    id: string = uuidv4();

    /**
     * Copies explicitly supported domain data into this DTO.
     *
     * Subclasses should expose only fields selected by the owning Service.
     *
     * @param object Domain object being mapped by a Service.
     * @returns This DTO instance.
     */
    fromObject(object: T): this {
        if (object && object.id) {
            this.id = object.id;
        }
        return this;
    }

    /**
     * Produces partial domain data for a Service-controlled mapping operation.
     *
     * @returns Partial data that a Service may use to construct or update an object.
     */
    toObject(): Partial<T> {
        const { ...data } = this;
        return data as unknown as Partial<T>;
    }
}
