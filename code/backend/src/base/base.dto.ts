import { IBaseDTO, IEntityDTO } from './interfaces.ts';
import { BaseObject } from './base.object.ts';
import { v4 as uuidv4 } from 'uuid';

/**
 * BaseDTO (Data Transfer Object) defines the contract for data exchanged between
 * the backend and external clients.
 *
 * RESPONSIBILITIES:
 * - Act as a filtered view of Domain Objects to prevent leaking sensitive internal state.
 * - Provide a consistent structure for API responses and requests.
 *
 * IMPORT RULES:
 * - ALLOWED: Basic TypeScript types, Base classes.
 * - FORBIDDEN: Stores, Services (DTOs should be pure data containers).
 *
 * CONSTRAINTS:
 * - Must NOT contain business logic or database access code.
 */
export abstract class BaseDTO implements IBaseDTO {
  id: string = uuidv4();

  constructor(data?: Partial<BaseDTO>) {
    if (data) {
      Object.assign(this, data);
    }
  }
}

/**
 * Specialized base class for DTOs that represent a domain entity.
 * Provides mapping methods to convert between the Domain Object and the DTO.
 */
export abstract class EntityDTO<T extends BaseObject> extends BaseDTO implements IEntityDTO<T> {
  /**
   * Maps a domain object to this DTO.
   * Should be overridden in subclasses to define which fields are exposed.
   */
  fromObject(object: T): this {
    if (object && object.id) {
      this.id = object.id;
    }
    return this;
  }

  /**
   * Maps the DTO data back to a partial domain object for creation or update.
   */
  toObject(): Partial<T> {
    const { ...data } = this;
    return data as unknown as Partial<T>;
  }
}
