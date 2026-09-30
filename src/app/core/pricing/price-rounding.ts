/**
 * Criterio de redondeo monetario, réplica de `PriceRoundingService` del backend.
 *
 * Son **dos** decisiones ortogonales: el modo dice *a qué* se redondea (decimales o múltiplo) y la
 * dirección *para qué lado*. Las declara cada **regla de precio** (`price_rules.rounding_mode` /
 * `rounding_direction`, migraciones `v74` y `v75`); un producto sin regla resuelta usa los defaults.
 *
 * Antes de `v74` el criterio era la config de sucursal `branch.pricing.roundingMode` —una sola para
 * todas las listas del local, y con la dirección implícita en el modo—. Esa clave ya no existe.
 *
 * Vive en `core` y no en una feature porque lo comparten quien lo **declara** (el formulario de
 * reglas de precio) y quien lo **aplica** (el punto de venta, que anticipa los importes de la línea):
 * si divergen, la pantalla miente sobre el total que el cajero está por cobrar.
 */

import { halfUp, shift } from './decimals';

/** `PriceRoundingMode`: a qué se redondea. Viaja como el nombre plano del enum. */
export const PRICE_ROUNDING_MODES = [
  'TWO_DECIMALS',
  'ONE_DECIMAL',
  'ZERO_DECIMALS',
  'MULTIPLE_10',
  'MULTIPLE_100',
] as const;

export type PriceRoundingMode = (typeof PRICE_ROUNDING_MODES)[number];

/** `PriceRoundingMode.defaultMode()`. */
export const DEFAULT_PRICE_ROUNDING_MODE: PriceRoundingMode = 'TWO_DECIMALS';

/** `PriceRoundingDirection`: para qué lado se redondea. */
export const PRICE_ROUNDING_DIRECTIONS = ['UP', 'DOWN', 'NEAREST'] as const;

export type PriceRoundingDirection = (typeof PRICE_ROUNDING_DIRECTIONS)[number];

/** `PriceRoundingDirection.defaultDirection()`. */
export const DEFAULT_PRICE_ROUNDING_DIRECTION: PriceRoundingDirection = 'NEAREST';

/** Las dos mitades del criterio, que siempre se aplican juntas. */
export interface PriceRounding {
  mode: PriceRoundingMode;
  direction: PriceRoundingDirection;
}

/** El criterio de un producto que ninguna regla alcanza: dos decimales, al más cercano. */
export const DEFAULT_PRICE_ROUNDING: PriceRounding = {
  mode: DEFAULT_PRICE_ROUNDING_MODE,
  direction: DEFAULT_PRICE_ROUNDING_DIRECTION,
};

export function toPriceRoundingMode(value: string | null | undefined): PriceRoundingMode {
  return PRICE_ROUNDING_MODES.find((mode) => mode === value) ?? DEFAULT_PRICE_ROUNDING_MODE;
}

export function toPriceRoundingDirection(value: string | null | undefined): PriceRoundingDirection {
  return (
    PRICE_ROUNDING_DIRECTIONS.find((direction) => direction === value) ??
    DEFAULT_PRICE_ROUNDING_DIRECTION
  );
}

/** Arma el criterio desde lo que declara una regla; cada mitad cae a su default por separado. */
export function toPriceRounding(
  mode: string | null | undefined,
  direction: string | null | undefined,
): PriceRounding {
  return { mode: toPriceRoundingMode(mode), direction: toPriceRoundingDirection(direction) };
}

/** `PriceRoundingService.round`. */
export function roundAmount(value: number, { mode, direction }: PriceRounding): number {
  switch (mode) {
    case 'ONE_DECIMAL':
      return roundToDecimals(value, 1, direction);
    case 'ZERO_DECIMALS':
      return roundToDecimals(value, 0, direction);
    case 'MULTIPLE_10':
      return roundToMultiple(value, 10, direction);
    case 'MULTIPLE_100':
      return roundToMultiple(value, 100, direction);
    case 'TWO_DECIMALS':
    default:
      return roundToDecimals(value, 2, direction);
  }
}

function roundToDecimals(
  value: number,
  decimals: number,
  direction: PriceRoundingDirection,
): number {
  return shift(applyDirection(shift(value, decimals), direction), -decimals);
}

/** `divide(multiplo, 0, rounding) × multiplo`: 1986 con múltiplo 10 y `UP` da 1990. */
function roundToMultiple(
  value: number,
  multiple: number,
  direction: PriceRoundingDirection,
): number {
  return applyDirection(value / multiple, direction) * multiple;
}

/** Los equivalentes de `RoundingMode` con los que redondea el backend. */
function applyDirection(value: number, direction: PriceRoundingDirection): number {
  switch (direction) {
    case 'UP': // CEILING
      return Math.ceil(value);
    case 'DOWN': // FLOOR
      return Math.floor(value);
    case 'NEAREST': // HALF_UP: el empate se aleja del cero, y `Math.round` lo lleva a +∞.
    default:
      return halfUp(value);
  }
}
