/**
 * Los tipos de valor de un campo con nombre: el sistema de tipos que comparten los atributos de
 * categoría y los campos extra de empleado (`AttributeValueType` en el backend, en `Enums/Common`).
 *
 * Vive en `core/` y no en una feature porque lo usan dos, y una copia por feature eran dos verdades
 * que divergen en la primera corrección. Las etiquetas están en `attributeValueTypes.*` de los
 * archivos de idioma.
 */
export const ATTRIBUTE_VALUE_TYPES = ['text', 'number', 'decimal', 'boolean', 'date'] as const;

export type AttributeValueType = (typeof ATTRIBUTE_VALUE_TYPES)[number];

export const DEFAULT_ATTRIBUTE_VALUE_TYPE: AttributeValueType = 'text';

export function isAttributeValueType(value: string): value is AttributeValueType {
  return (ATTRIBUTE_VALUE_TYPES as readonly string[]).includes(value);
}
