import { v4 as uuidv4 } from 'uuid';

import type { IBaseObject } from './interfaces.ts';

/**
 * BaseObject is the root for all Domain Objects in the system.
 *
 * RESPONSIBILITIES:
 * - Represent a business entity with its core properties and identity (UUID).
 * - Provide standardized metadata like timestamps and soft-delete flags.
 *
 * IMPORT RULES:
 * - ALLOWED: Basic TypeScript types, Base classes.
 * - FORBIDDEN: Services, Controllers, Stores (Objects are pure domain models).
 *
 * CONSTRAINTS:
 * - Must NOT contain logic for persisting itself to the database.
 */
export abstract class BaseObject implements IBaseObject {
    id: string = uuidv4();
    createdAt: Date = new Date();
    updatedAt: Date = new Date();
    isDeleted: boolean = false;
    deletedAt?: Date;

    constructor(data: Partial<BaseObject>) {
        Object.assign(this, data);
        // Sicherstellen, dass updatedAt bei Initialisierung gesetzt ist
        if (data.updatedAt) this.updatedAt = data.updatedAt;
    }

    /**
     * Validates the object.
     * Should be overridden in subclasses if specific rules exist.
     * @throws Error if validation fails.
     */
    validate(): void {
        // Default validation: ID must be present
        if (!this.id) {
            throw new Error(`${this.constructor.name} must have an id`);
        }
    }

    /**
     * Converts the domain object into a plain JavaScript object
     * suitable for API responses (JSON).
     */
    toJSON() {
        const json = { ...this };
        // Sensitive fields can be removed or formats adjusted here
        return json;
    }

    /**
     * Marks the object as deleted (Soft Delete).
     */
    softDelete(): void {
        this.isDeleted = true;
        this.deletedAt = new Date();
        this.updatedAt = new Date();
    }
}
