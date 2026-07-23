import { BaseDTO } from '../../../base/base.dto.ts';

/** Transport-neutral health information returned by the health module. */
export class HealthStatusDTO extends BaseDTO {
    public status: string;

    /** Creates a health-status response DTO. */
    constructor(status: string) {
        super();
        this.status = status;
    }
}
