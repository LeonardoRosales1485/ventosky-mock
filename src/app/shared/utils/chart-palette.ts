import { ThemeMode } from '../../core/theme/theme.service';

/**
 * Paleta categórica de los gráficos: identidad, no magnitud. Cada ranura es un color fijo y se
 * asignan **en orden**, nunca cíclicamente.
 *
 * El orden es el mecanismo de seguridad para daltonismo, no una decisión estética: es un orden
 * validado en el que ningún par contiguo se confunde bajo protanopía ni deuteranopía (ΔE OKLab
 * ≥ 8) ni bajo visión normal (ΔE ≥ 15), en los dos temas. Cambiar el orden —o inventar un color
 * noveno— rompe esa garantía.
 *
 * La columna oscura no es otra paleta: son los mismos ocho tonos escalonados para el fondo oscuro.
 */
const SERIES_COLORS: Record<ThemeMode, readonly string[]> = {
  light: [
    '#6352ee', // violeta (acento de la Propuesta B)
    '#eb6834', // naranja
    '#1baf7a', // agua
    '#eda100', // amarillo
    '#e87ba4', // magenta
    '#008300', // verde
    '#2a78d6', // azul
    '#e34948', // rojo
  ],
  dark: [
    '#9b8fff',
    '#d95926',
    '#199e70',
    '#c98500',
    '#d55181',
    '#008300',
    '#3987e5',
    '#e66767',
  ],
};

/**
 * Cuántas series admite un gráfico categórico. Pasado el tope no se genera un color nuevo: bajo
 * daltonismo sería indistinguible de alguno de los ocho, así que lo que sobra no se grafica.
 */
export const CHART_SERIES_SLOTS = SERIES_COLORS.light.length;

/**
 * Color de una ranura, o `null` cuando la serie quedó fuera del tope. El color sale de la posición
 * estable de la entidad —no de su lugar en el gráfico de hoy—, así que filtrar una serie no repinta
 * a las demás: quien aprendió que «Mayorista es naranja» lo sigue leyendo igual.
 */
export function chartSeriesColor(slot: number, theme: ThemeMode): string | null {
  const colors = SERIES_COLORS[theme];
  return slot >= 0 && slot < colors.length ? colors[slot] : null;
}
