import {
  SchemaPathTree,
  ValidationError,
  applyEach,
  applyWhen,
  email,
  max,
  maxLength,
  min,
  pattern,
  required,
  validate,
} from '@angular/forms/signals';
import { AttributeValueType } from '../../../../core/attributes/attribute-value-type';
import {
  PARTY_CONTACT_VALUE_MAX_LENGTH,
  PARTY_DOC_NUMBER_MAX_LENGTH,
  PARTY_DOC_NUMBER_PATTERN,
  PARTY_NAME_MAX_LENGTH,
  PARTY_TAX_CONDITION_MAX_LENGTH,
} from '../../../../core/parties/party.model';
import { password, username } from '../../../../shared/utils/signal-validators';
import { AccessModel, DirectoryFormModel } from '../../data-access/directory-forms';

/** Los mismos topes que valida el backend al guardar la ficha de cada tipo. */
export const EMPLOYEE_FIELD_LIMITS = {
  fileNumber: 20,
  licenseNumber: 30,
  licenseClass: 10,
  vehiclePlate: 15,
  vehicleDescription: 100,
} as const;

/** La forma de un campo extra según su tipo. El backend lo vuelve a validar: esto sólo lo anticipa. */
export function attributeValueError(type: AttributeValueType, raw: string): ValidationError | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  switch (type) {
    case 'number':
      return /^-?\d+$/.test(value) ? null : { kind: 'attributeNumber' };
    case 'decimal':
      return Number.isFinite(Number(value.replace(',', '.'))) ? null : { kind: 'attributeDecimal' };
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : { kind: 'attributeDate' };
    default:
      return null;
  }
}

/** Usuario y contraseña, sólo mientras el bloque de acceso va a crear un usuario nuevo. */
export function accessSchema(path: SchemaPathTree<AccessModel>): void {
  applyWhen(
    path,
    ({ value }) => value().enabled && !value().existingUserUuid,
    (access) => {
      username(access.username);
      password(access.password);
    },
  );
}

/**
 * Las reglas de todos los campos del directorio. Un vínculo que no dibuja un campo lo deja vacío, y vacío pasa
 * cualquiera de estas reglas: por eso alcanza con un solo esquema para los siete formularios.
 */
export function directoryFormSchema(path: SchemaPathTree<DirectoryFormModel>): void {
  required(path.name);
  maxLength(path.name, PARTY_NAME_MAX_LENGTH);
  maxLength(path.docNumber, PARTY_DOC_NUMBER_MAX_LENGTH);
  // Sin documento es un estado válido, así que el patrón sólo aplica cuando hay algo tipeado.
  pattern(path.docNumber, ({ value }) => (value() ? PARTY_DOC_NUMBER_PATTERN : undefined));
  maxLength(path.taxCondition, PARTY_TAX_CONDITION_MAX_LENGTH);
  email(path.email);
  maxLength(path.email, PARTY_CONTACT_VALUE_MAX_LENGTH);

  linkFieldsSchema(path);

  applyEach(path.attributes, (attribute) => {
    validate(attribute.value, ({ value, valueOf }) =>
      attributeValueError(valueOf(attribute.type), value()),
    );
  });

  accessSchema(path.access);
}

/**
 * Los campos de los vínculos: los de la carpeta y los de los vínculos que piden los roles. «Dar acceso» los usa sin
 * la identidad, que no toca.
 */
export function linkFieldsSchema(path: SchemaPathTree<DirectoryFormModel>): void {
  maxLength(path.fileNumber, EMPLOYEE_FIELD_LIMITS.fileNumber);
  maxLength(path.licenseNumber, EMPLOYEE_FIELD_LIMITS.licenseNumber);
  maxLength(path.licenseClass, EMPLOYEE_FIELD_LIMITS.licenseClass);
  maxLength(path.vehiclePlate, EMPLOYEE_FIELD_LIMITS.vehiclePlate);
  maxLength(path.vehicleDescription, EMPLOYEE_FIELD_LIMITS.vehicleDescription);
  min(path.commissionRate, 0);
  max(path.commissionRate, 100);
  min(path.salesGoalAmount, 0);
}
