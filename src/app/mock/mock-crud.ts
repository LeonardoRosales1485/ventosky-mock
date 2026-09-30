import { PaginateQuery } from '../core/paginate';
import { MockDb, Row, clone, newUuid, nowIso } from './mock-db';
import { MockReply, MockRequest, fail, ok } from './mock-http';
import { mockPaginate } from './mock-paginate';

const UUID_SEGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function lookupByUuid(uuid: string): Row | undefined {
  return MockDb.findAnywhere(uuid);
}

function displayName(row: Row): string | undefined {
  const candidates = ['name', 'username', 'businessName', 'fullName', 'code', 'publicId'];
  for (const key of candidates) {
    if (typeof row[key] === 'string') {
      return row[key] as string;
    }
  }
  const party = row['party'] as Row | undefined;
  return party ? displayName(party) : undefined;
}

/**
 * Un save manda las relaciones como `{ uuid }`; el listado las devuelve como `{ uuid, name }`.
 * Completa el nombre (y lo demás que se sepa) mirando las colecciones del mock.
 */
export function enrichRefs(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => enrichRefs(item, depth + 1));
  }
  const record = value as Row;
  const keys = Object.keys(record);
  if (keys.length <= 2 && typeof record.uuid === 'string' && keys.every((k) => k === 'uuid' || k === 'name')) {
    const found = lookupByUuid(record.uuid);
    if (found) {
      return { uuid: record.uuid, name: displayName(found) ?? record['name'] ?? null };
    }
    return record;
  }
  const out: Row = {};
  for (const [key, inner] of Object.entries(record)) {
    out[key] = enrichRefs(inner, depth + 1);
  }
  return out;
}

export function paginateCollection(key: string, req: MockRequest): MockReply {
  const rows = MockDb.collection(key).filter((row) => row['status'] !== -1);
  return ok(mockPaginate(rows, req.body as PaginateQuery));
}

export function saveInCollection(key: string, payload: Row, extra: Row = {}): Row {
  const uuid = typeof payload.uuid === 'string' && payload.uuid ? payload.uuid : newUuid();
  const existing = MockDb.detail(key, uuid);

  if (
    existing &&
    typeof payload['version'] === 'number' &&
    typeof existing['version'] === 'number' &&
    payload['version'] !== existing['version']
  ) {
    fail(409, 'VERSION_CONFLICT', 'El registro cambió desde que se leyó.', {
      currentVersion: existing['version'],
    });
  }

  const merged: Row = {
    ...(existing ?? {}),
    ...(enrichRefs(payload) as Row),
    ...extra,
    uuid,
    status: (existing?.['status'] as number | undefined) ?? 0,
    dateCreated: existing?.['dateCreated'] ?? nowIso(),
    version: ((existing?.['version'] as number | undefined) ?? -1) + 1,
  };
  MockDb.upsert(key, merged);
  MockDb.setDetail(key, uuid, merged);
  return clone(merged);
}

export function saveHandler(key: string, req: MockRequest): MockReply {
  if (Array.isArray(req.body)) {
    return ok((req.body as Row[]).map((item) => saveInCollection(key, item)));
  }
  return ok(saveInCollection(key, (req.body ?? {}) as Row));
}

export function byUuidHandler(key: string, uuid: string): MockReply {
  const found = MockDb.detail(key, uuid);
  if (!found) {
    fail(404, 'NOT_FOUND', `No existe ${key} ${uuid}`);
  }
  return ok(clone(found));
}

export function deleteHandler(key: string, uuid: string): MockReply {
  const removed = MockDb.remove(key, uuid);
  if (!removed) {
    fail(404, 'NOT_FOUND', `No existe ${key} ${uuid}`);
  }
  return ok({ ...removed, status: -1 });
}

/**
 * Lo genérico: cualquier recurso con el ABM del Core (`/paginate`, `/save`, `/uuid/{id}`,
 * `DELETE /{id}`) funciona sin handler propio.
 */
export function genericCrud(req: MockRequest): MockReply | null {
  const { method, path } = req;

  let match = /^(.+?)\/paginate(-all)?$/.exec(path);
  if (method === 'POST' && match) {
    return paginateCollection(match[1], req);
  }

  match = /^(.+?)\/save(\/list)?$/.exec(path);
  if (method === 'POST' && match) {
    return saveHandler(match[1], req);
  }

  match = /^(.+?)\/uuid\/([^/]+)$/.exec(path);
  if (method === 'GET' && match) {
    return byUuidHandler(match[1], match[2]);
  }

  match = /^(.+)\/([^/]+)$/.exec(path);
  if (method === 'DELETE' && match && MockDb.hasCollection(match[1])) {
    return deleteHandler(match[1], match[2]);
  }

  return null;
}

/**
 * Lo grabado de staging. Primero la clave exacta, después sin query y, por último, la misma ruta con
 * otro uuid: un GET de detalle de algo creado en el mock responde con la forma de uno real.
 */
export function replay(req: MockRequest): MockReply | null {
  const exact = MockDb.recorded(`${req.method} ${req.pathWithQuery}`) ?? MockDb.recorded(`${req.method} ${req.path}`);
  if (exact) {
    return ok(clone(exact.body), exact.status);
  }
  if (req.method !== 'GET') {
    return null;
  }

  // Misma ruta con otra query: gana la grabación que comparte más parámetros (sin contar paginado).
  const sameQuery = MockDb.recordedKeys()
    .filter((key) => key.startsWith(`GET ${req.path}?`))
    .map((key) => {
      const params = new URLSearchParams(key.split('?')[1]);
      let score = 0;
      params.forEach((value, name) => {
        if (name !== 'page' && name !== 'size') {
          score += req.params.get(name) === value ? 2 : -1;
        }
      });
      return { key, score };
    })
    .sort((a, b) => b.score - a.score)[0];
  if (sameQuery) {
    const recorded = MockDb.recorded(sameQuery.key)!;
    return ok(clone(recorded.body), recorded.status);
  }

  const shape = req.path.replace(UUID_SEGMENT, ':id');
  if (shape === req.path) {
    return null;
  }
  const template = MockDb.recordedKeys().find(
    (key) => key.startsWith('GET ') && key.slice(4).split('?')[0].replace(UUID_SEGMENT, ':id') === shape,
  );
  if (!template) {
    return null;
  }
  const recorded = MockDb.recorded(template)!;
  return ok(clone(recorded.body), recorded.status);
}
