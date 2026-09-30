/**
 * El formato de la etiqueta de balanza, desarmado en sus cuatro partes.
 *
 * Vive en `core` porque lo leen las dos puntas de la misma configuración: el editor que la escribe
 * —en la pantalla de configuración— y la ficha de producto, que exige el código de balanza con el
 * largo que ese formato declara. Un módulo puro, además, se prueba sin levantar Angular, que es lo
 * único que la suite de este repo corre en verde hoy.
 *
 * El texto que se persiste es `prefijo:largoCódigo:largoValor:tipo` — `2:5:5:WEIGHT` es el ejemplo
 * del documento funcional. Los decimales **no** son un quinto campo: los fija el tipo, porque son la
 * unidad en la que la balanza cuenta (`WEIGHT` escribe gramos y `AMOUNT` centavos).
 */

/** Lo que lleva embebido la etiqueta: el peso pesado o el importe ya calculado. */
export const SCALE_VALUE_TYPES = ['WEIGHT', 'AMOUNT'] as const;

export type ScaleValueType = (typeof SCALE_VALUE_TYPES)[number];

export interface ScaleFormatParts {
  prefix: string;
  codeLength: string;
  valueLength: string;
  valueType: ScaleValueType;
}

export const EMPTY_SCALE_FORMAT: ScaleFormatParts = {
  prefix: '',
  codeLength: '',
  valueLength: '',
  valueType: 'WEIGHT',
};

/**
 * Desarma el texto guardado. Un texto que no se entiende cae a vacío en vez de fallar: es lo mismo
 * que hace el punto de venta al leerlo, y acá además deja los campos listos para escribirlo bien.
 */
export function parseScaleFormat(raw: string | null): ScaleFormatParts {
  const parts = (raw ?? '').trim().split(':');
  if (parts.length !== 4) {
    return EMPTY_SCALE_FORMAT;
  }

  const valueType = SCALE_VALUE_TYPES.find((type) => type === parts[3].trim().toUpperCase());
  return {
    prefix: parts[0].trim(),
    codeLength: parts[1].trim(),
    valueLength: parts[2].trim(),
    valueType: valueType ?? 'WEIGHT',
  };
}

export function formatScaleFormat(parts: ScaleFormatParts): string {
  return `${parts.prefix}:${parts.codeLength}:${parts.valueLength}:${parts.valueType}`;
}

/**
 * Si las cuatro partes alcanzan para leer una etiqueta. Media configuración no se persiste: un
 * `2::5:WEIGHT` respeta la forma del texto y no desarma nada.
 */
export function isCompleteScaleFormat(parts: ScaleFormatParts): boolean {
  return (
    parts.prefix.length > 0 &&
    scaleCodeLength(parts) > 0 &&
    scaleValueLength(parts) > 0
  );
}

export function scaleCodeLength(parts: ScaleFormatParts): number {
  return toLength(parts.codeLength);
}

export function scaleValueLength(parts: ScaleFormatParts): number {
  return toLength(parts.valueLength);
}

/**
 * Cuántos dígitos tiene el código de balanza de un producto según el texto guardado, o `null` si
 * ese texto no declara un formato utilizable —no hay ninguno, está a medias, o no se entiende—.
 *
 * Es lo que necesita la ficha de producto: el código que se persiste tiene que ser **exactamente**
 * el tramo que el backend recorta de la etiqueta, porque la resolución es una comparación literal
 * contra `products.scale_code`. Con `2:5:5:WEIGHT`, un producto guardado como `123` no lo encuentra
 * ninguna etiqueta: la balanza imprime `00123`.
 */
export function scaleCodeLengthOf(raw: string | null): number | null {
  const parts = parseScaleFormat(raw);
  return isCompleteScaleFormat(parts) ? scaleCodeLength(parts) : null;
}

function toLength(raw: string): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** El ejemplo se recorta o se rellena para que ocupe exactamente el largo configurado. */
export function padScaleSample(sample: string, length: number): string {
  if (length <= 0) {
    return '';
  }
  return length <= sample.length
    ? sample.slice(sample.length - length)
    : sample.padStart(length, '0');
}
