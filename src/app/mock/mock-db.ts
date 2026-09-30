import dump from './fixtures/staging-dump.json';

export type Row = Record<string, unknown> & { uuid?: string };

interface Recorded {
  status: number;
  body: unknown;
}

interface MockState {
  version: number;
  /** Filas de listado por recurso (`/brand`, `/party/customer`, `/product#catalog`…). */
  collections: Record<string, Row[]>;
  /** Detalle (`GET {recurso}/uuid/{uuid}`) por `recurso|uuid`: suele traer más campos que la fila. */
  details: Record<string, Row>;
  /** Todo lo demás que se grabó de staging, por `MÉTODO /path?query`. */
  responses: Record<string, Recorded>;
  /** uuid → nombre de todo lo que aparece en el dump, para completar referencias `{ uuid }`. */
  names: Record<string, string>;
  seq: number;
}

const STORAGE_KEY = 'ventosky.mock.db';
/** Subirlo invalida lo guardado en el navegador y vuelve a sembrar desde el dump. */
const STATE_VERSION = 2;

const PAGINATE_RE = /^POST (.+?)\/paginate(-all|-catalog)?$/;
const DETAIL_RE = /^GET (.+?)\/uuid\/([^/?]+)$/;

function seed(): MockState {
  const state: MockState = {
    version: STATE_VERSION,
    collections: {},
    details: {},
    responses: {},
    names: {},
    seq: 1000,
  };
  const recorded = dump as unknown as Record<string, Recorded>;

  for (const [key, value] of Object.entries(recorded)) {
    const paginate = PAGINATE_RE.exec(key);
    if (paginate) {
      const [, prefix, suffix] = paginate;
      const content = ((value.body as { content?: Row[] } | null)?.content ?? []) as Row[];
      const collectionKey = suffix === '-catalog' ? `${prefix}#catalog` : prefix;
      const existing = state.collections[collectionKey] ?? [];
      const byUuid = new Map(existing.map((row) => [row.uuid, row]));
      for (const row of content) {
        byUuid.set(row.uuid ?? `${byUuid.size}`, row);
      }
      state.collections[collectionKey] = [...byUuid.values()];
      continue;
    }
    const detail = DETAIL_RE.exec(key);
    if (detail && value.status === 200 && value.body) {
      state.details[`${detail[1]}|${detail[2]}`] = value.body as Row;
      continue;
    }
    state.responses[key] = value;
  }
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record['uuid'] === 'string' && typeof record['name'] === 'string') {
        state.names[record['uuid']] ??= record['name'];
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(Object.values(recorded).map((value) => value.body));
  return state;
}

function load(): MockState {
  try {
    if (new URLSearchParams(location.search).has('mockReset')) {
      localStorage.removeItem(STORAGE_KEY);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockState;
      if (parsed.version === STATE_VERSION) {
        return parsed;
      }
    }
  } catch {
    // Storage bloqueado o corrupto: se arranca de la semilla.
  }
  return seed();
}

/**
 * La «base de datos» del mock: una sola, en memoria, persistida en localStorage.
 *
 * Es un módulo y no un servicio de Angular a propósito: la usan el backend falso y los handlers, y
 * así no entra en el grafo de inyección de `HttpClient`.
 */
class MockDbImpl {
  private state: MockState = load();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  reset(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
    this.state = seed();
  }

  collection(key: string): Row[] {
    return (this.state.collections[key] ??= []);
  }

  hasCollection(key: string): boolean {
    return key in this.state.collections;
  }

  collectionKeys(): string[] {
    return Object.keys(this.state.collections);
  }

  find(key: string, uuid: string): Row | undefined {
    return this.collection(key).find((row) => row.uuid === uuid);
  }

  detail(key: string, uuid: string): Row | undefined {
    const detail = this.state.details[`${key}|${uuid}`];
    const row = this.find(key, uuid);
    if (detail && row) {
      // El detalle es la foto de staging; lo que se editó en el mock vive en la fila.
      return { ...detail, ...row };
    }
    return detail ?? row;
  }

  setDetail(key: string, uuid: string, value: Row): void {
    this.state.details[`${key}|${uuid}`] = value;
    this.persist();
  }

  /** Cualquier entidad con ese uuid: filas de colección o detalles grabados (p. ej. categorías). */
  findAnywhere(uuid: string): Row | undefined {
    for (const rows of Object.values(this.state.collections)) {
      const found = rows.find((row) => row.uuid === uuid);
      if (found) {
        return found;
      }
    }
    for (const [key, value] of Object.entries(this.state.details)) {
      if (key.endsWith(`|${uuid}`)) {
        return value;
      }
    }
    const name = this.state.names[uuid];
    return name ? { uuid, name } : undefined;
  }

  removeDetail(key: string, uuid: string): void {
    delete this.state.details[`${key}|${uuid}`];
  }

  upsert(key: string, row: Row): Row {
    const rows = this.collection(key);
    const index = rows.findIndex((item) => item.uuid === row.uuid);
    if (index >= 0) {
      rows[index] = row;
    } else {
      rows.unshift(row);
    }
    this.persist();
    return row;
  }

  remove(key: string, uuid: string): Row | undefined {
    const rows = this.collection(key);
    const index = rows.findIndex((item) => item.uuid === uuid);
    if (index < 0) {
      return undefined;
    }
    const [removed] = rows.splice(index, 1);
    this.removeDetail(key, uuid);
    this.persist();
    return removed;
  }

  recorded(key: string): Recorded | undefined {
    return this.state.responses[key];
  }

  record(key: string, body: unknown, status = 200): void {
    this.state.responses[key] = { status, body };
    this.persist();
  }

  recordedKeys(): string[] {
    return Object.keys(this.state.responses);
  }

  nextSeq(): number {
    this.state.seq += 1;
    this.persist();
    return this.state.seq;
  }

  persist(): void {
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (error) {
        console.warn('[mock] No se pudo guardar la base en localStorage', error);
      }
    }, 250);
  }
}

export const MockDb = new MockDbImpl();

/** UUID v4 aleatorio, suficiente para el mock. */
export function newUuid(): string {
  return crypto.randomUUID();
}

/** ISO 8601 con offset local, el formato con el que responde el backend. */
export function nowIso(): string {
  const date = new Date();
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (value: number) => String(Math.floor(Math.abs(value))).padStart(2, '0');
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 23);
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
