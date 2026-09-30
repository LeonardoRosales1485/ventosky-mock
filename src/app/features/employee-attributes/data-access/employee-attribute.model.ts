import { AttributeValueType } from '../../../core/attributes/attribute-value-type';
import { Versioned } from '../../../core/concurrency/version-conflict.model';

/** Un campo extra del catálogo de la empresa (`EmployeeAttributeDTO`). */
export interface EmployeeAttributeDto extends Versioned {
  uuid: string;
  name: string;
  /** Uno de los `ATTRIBUTE_VALUE_TYPES`. No cambia si algún empleado ya tiene el campo completado. */
  type: string;
}

export interface EmployeeAttributeSavePayload {
  uuid?: string;
  name: string;
  type: AttributeValueType;
  /** Versión leída al abrir el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
}
