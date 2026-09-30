import { OpeningLineRequest } from './opening-balance.model';

/** Una fila que no se pudo interpretar, con su número para que alguien la busque en el archivo. */
export interface OpeningCsvError {
  line: number;
  message: string;
}

export interface OpeningCsvResult {
  lines: OpeningLineRequest[];
  errors: OpeningCsvError[];
}

/** Las columnas, en orden. El archivo puede traerlas como encabezado o no traerlo. */
const COLUMNS = ['tipo', 'documento', 'rol', 'comprobante', 'importe', 'emision', 'vencimiento'];

const TYPES: Record<string, string> = {
  DEBT: 'DEBT',
  DEUDA: 'DEBT',
  D: 'DEBT',
  CREDIT: 'CREDIT',
  CREDITO: 'CREDIT',
  SALDO: 'CREDIT',
  C: 'CREDIT',
};

const ROLES: Record<string, string> = {
  CUSTOMER: 'CUSTOMER',
  CLIENTE: 'CUSTOMER',
  SUPPLIER: 'SUPPLIER',
  PROVEEDOR: 'SUPPLIER',
};

/**
 * Interpreta el CSV de saldos iniciales.
 *
 * **El parseo vive acá y no en el backend** a propósito: el archivo se interpreta donde la persona
 * puede ver lo que está mandando, y lo que viaja son líneas ya estructuradas. Que el servidor adivine
 * separadores y codificaciones agregaría una capa de errores silenciosos justo sobre el único dato
 * del módulo que después no se compara contra nada.
 *
 * **Una fila mal formada no descarta el resto**: sale como error con su número de línea y la pantalla
 * las muestra todas juntas. Corregir un archivo de a un error por vez es el peor uso posible del
 * tiempo de quien lo está cargando.
 */
export function parseOpeningCsv(text: string): OpeningCsvResult {
  const result: OpeningCsvResult = { lines: [], errors: [] };
  const rows = (text ?? '').split(/\r?\n/);

  let numero = 0;
  for (const raw of rows) {
    numero++;
    const row = raw.trim();
    if (!row) {
      continue;
    }
    const cells = split(row);
    if (numero === 1 && isHeader(cells)) {
      continue;
    }
    if (cells.length < 6) {
      result.errors.push({ line: numero, message: `faltan columnas (${cells.length} de 7)` });
      continue;
    }

    const type = TYPES[normalize(cells[0])];
    if (!type) {
      result.errors.push({ line: numero, message: `tipo desconocido: "${cells[0]}"` });
      continue;
    }
    const role = ROLES[normalize(cells[2])];
    if (!role) {
      result.errors.push({ line: numero, message: `rol desconocido: "${cells[2]}"` });
      continue;
    }
    const amount = toAmount(cells[4]);
    if (amount === null) {
      result.errors.push({ line: numero, message: `importe ilegible: "${cells[4]}"` });
      continue;
    }
    const issued = toDate(cells[5]);
    if (!issued) {
      result.errors.push({ line: numero, message: `fecha de emisión ilegible: "${cells[5]}"` });
      continue;
    }
    // El vencimiento se manda tal como vino, incluso vacío: **quien decide si falta es el backend**,
    // que es donde vive la regla de que una deuda sin vencimiento no se carga. Adelantarla acá
    // significaría tener la misma regla escrita dos veces, y la primera vez que cambie va a cambiar
    // en un solo lado.
    const due = cells.length > 6 ? toDate(cells[6]) : null;
    if (cells.length > 6 && cells[6].trim() && !due) {
      result.errors.push({ line: numero, message: `vencimiento ilegible: "${cells[6]}"` });
      continue;
    }

    const line: OpeningLineRequest = {
      partyDocument: cells[1].trim(),
      role,
      type,
      publicId: cells[3].trim(),
      amount,
      dateIssued: `${issued}T00:00:00.000`,
    };
    if (due) {
      line.dateDue = due;
    }
    result.lines.push(line);
  }
  return result;
}

/** `;`, `,` o tabulador: los tres salen de un «guardar como CSV» según la máquina. */
function split(row: string): string[] {
  const separator = row.includes(';') ? ';' : row.includes('\t') ? '\t' : ',';
  return row.split(separator);
}

function isHeader(cells: readonly string[]): boolean {
  return COLUMNS.some((column) => normalize(cells[0]) === normalize(column));
}

function normalize(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Acepta `1.234,56` y `1234.56`.
 *
 * Un archivo exportado en una máquina en español trae la coma como decimal, y el mismo archivo
 * exportado en otra trae el punto. Elegir uno solo garantiza que la mitad de las cargas entren con
 * los importes multiplicados por cien.
 */
function toAmount(value: string): number | null {
  const raw = (value ?? '').trim().replace(/\s/g, '');
  if (!raw) {
    return null;
  }
  const normalized =
    raw.includes(',') && raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Acepta `dd/mm/aaaa` y `aaaa-mm-dd`, y devuelve siempre `aaaa-mm-dd`. */
function toDate(value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) {
    return null;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) {
    return raw;
  }
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (!local) {
    return null;
  }
  const [, day, month, year] = local;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
