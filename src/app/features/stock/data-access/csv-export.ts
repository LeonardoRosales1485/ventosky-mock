/**
 * Una exportación mínima a CSV desde el navegador: lo que el panel tiene cargado, tal como se ve.
 *
 * Es deliberadamente simple —sin librería, sin formato— porque lo que se exporta es una lista de
 * partidas para llevar al depósito o mandar al proveedor, no un reporte. Separador `;` y BOM para
 * que Excel en castellano lo abra en columnas sin preguntar.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [headers, ...rows].map((row) => row.map(escape).join(';')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
