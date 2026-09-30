import { PaginateQuery } from '../core/paginate';
import { enrichRefs, saveInCollection } from './mock-crud';
import { MockDb, Row, clone, newUuid, nowIso } from './mock-db';
import { MockRoute, fail, ok, route } from './mock-http';
import { mockPaginate } from './mock-paginate';

const MOCK_TOKEN = 'mock-token';

function me(): Row {
  const recorded = MockDb.recorded('GET /user/login');
  return clone((recorded?.body ?? {}) as Row);
}

function ref(row: Row | undefined | null): { uuid: string; name: string } | null {
  if (!row?.uuid) {
    return null;
  }
  return { uuid: row.uuid, name: String(row['name'] ?? row['username'] ?? '') };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------------------------

function defaultWarehouse(product: Row | undefined): Row | undefined {
  const stocks = (product?.['warehouseStocks'] as Row[] | undefined) ?? [];
  const first = stocks[0]?.['warehouse'] as Row | undefined;
  return first ?? MockDb.collection('/warehouse')[0];
}

/** Mueve `delta` unidades del producto en un depósito, en todas las vistas que lo muestran. */
export function adjustStock(productUuid: string, warehouseUuid: string | null, delta: number): void {
  if (!delta) {
    return;
  }
  const row = MockDb.find('/product', productUuid);
  const detail = MockDb.detail('/product', productUuid);
  const warehouse = warehouseUuid
    ? (MockDb.find('/warehouse', warehouseUuid) ?? { uuid: warehouseUuid, name: 'Depósito' })
    : defaultWarehouse(detail);

  if (row) {
    row['totalStock'] = round2(Number(row['totalStock'] ?? 0) + delta);
    MockDb.upsert('/product', row);
  }

  if (detail) {
    const stocks = ((detail['warehouseStocks'] as Row[] | undefined) ?? []).map((s) => ({ ...s }));
    const target = stocks.find((s) => (s['warehouse'] as Row | undefined)?.uuid === warehouse?.uuid);
    if (target) {
      target['quantity'] = round2(Number(target['quantity'] ?? 0) + delta);
    } else if (warehouse) {
      stocks.push({ warehouse: ref(warehouse), quantity: delta });
    }
    MockDb.setDetail('/product', productUuid, {
      ...detail,
      warehouseStocks: stocks,
      totalStock: round2(Number(detail['totalStock'] ?? 0) + delta),
    });
  }

  const distributionKey = `GET /stock/distribution/${productUuid}`;
  const distribution = MockDb.recorded(distributionKey)?.body as Row | undefined;
  const next: Row = distribution
    ? clone(distribution)
    : {
        product: ref(row ?? detail),
        totalQuantity: 0,
        allBranches: false,
        rows: [],
      };
  const rows = next['rows'] as Row[];
  const target = rows.find((r) => (r['warehouse'] as Row | undefined)?.uuid === warehouse?.uuid);
  if (target) {
    target['quantity'] = round2(Number(target['quantity'] ?? 0) + delta);
  } else if (warehouse) {
    rows.push({ branch: (warehouse['branch'] as Row | undefined) ?? null, warehouse: ref(warehouse), quantity: delta, batchCount: 1 });
  }
  next['totalQuantity'] = round2(Number(next['totalQuantity'] ?? 0) + delta);
  MockDb.record(distributionKey, next);
}

// ---------------------------------------------------------------------------------------------
// Catálogo agrupado
// ---------------------------------------------------------------------------------------------

function catalogRows(): Row[] {
  const recordedModels = MockDb.collection('/product#catalog').filter((r) => r['rowType'] !== 'PRODUCT');
  const products = MockDb.collection('/product')
    .filter((p) => !p['model'] && p['status'] !== -1)
    .map((product) => ({ rowType: 'PRODUCT', model: null, product }));
  return [...recordedModels, ...products];
}

// ---------------------------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------------------------

interface CommitItem {
  product: { uuid: string };
  quantity: number;
  unitPrice?: number;
  priceList?: { uuid: string };
  batches?: { batchUuid?: string; batchNumber?: string; expirationDate?: string; quantity: number }[];
}

function commitOrder(payload: Row, existing?: Row): Row {
  const voucher = MockDb.find('/voucher', (payload['voucher'] as Row | undefined)?.uuid ?? '') ?? (payload['voucher'] as Row);
  const cashRegister = MockDb.find('/cash-register', (payload['cashRegister'] as Row | undefined)?.uuid ?? '');
  const stockSign = voucher?.['stockEffect'] === 'INCREMENT' ? 1 : voucher?.['stockEffect'] === 'DECREMENT' ? -1 : 0;
  const addsTax = voucher?.['addsTax'] === true;

  let total = 0;
  let totalTax = 0;
  const items = ((payload['items'] as CommitItem[] | undefined) ?? []).map((item) => {
    const product = MockDb.detail('/product', item.product.uuid) ?? MockDb.find('/product', item.product.uuid);
    const entries = (product?.['priceListEntries'] as Row[] | undefined) ?? [];
    const entry = entries.find((e) => e['priceListUuid'] === item.priceList?.uuid) ?? entries[0];
    const unitPrice = Number(item.unitPrice ?? entry?.['price'] ?? 0);
    const taxRate = Number(product?.['taxRate'] ?? 0);
    const net = item.quantity * unitPrice;
    const taxAmount = round2(addsTax ? (net * taxRate) / 100 : net - net / (1 + taxRate / 100));
    const subtotal = round2(addsTax ? net + taxAmount : net);
    total += subtotal;
    totalTax += taxAmount;
    const warehouse = defaultWarehouse(product);
    const batches = item.batches?.length ? item.batches : [{ quantity: item.quantity }];
    return {
      uuid: newUuid(),
      product: ref(product) ?? item.product,
      priceList: item.priceList ? enrichRefs(item.priceList) : null,
      quantity: item.quantity,
      unitPrice,
      taxRate,
      taxAmount,
      discountAmount: 0,
      subtotal,
      stockItems: stockSign
        ? batches.map((batch) => ({
            uuid: newUuid(),
            warehouse: ref(warehouse),
            batchUuid: batch.batchUuid ?? null,
            batchNumber: batch.batchNumber ?? 'UNICO',
            expirationDate: batch.expirationDate ?? null,
            quantity: batch.quantity,
          }))
        : [],
      components: [],
    };
  });

  const payments = (((payload['orderCheckout'] as Row | undefined)?.['payments'] as Row[] | undefined) ?? []).map(
    (payment, index, all) => ({
      uuid: newUuid(),
      paymentMethod: enrichRefs(payment['paymentMethod']),
      amount: Number(payment['amount'] ?? (all.length === 1 ? total : 0)),
      state: 'AUTHORIZED',
    }),
  );

  for (const item of items) {
    for (const stock of item.stockItems) {
      adjustStock(item.product.uuid, stock.warehouse?.uuid ?? null, stockSign * Number(stock.quantity));
    }
  }

  const partyRoleUuid = (payload['partyRole'] as Row | undefined)?.uuid;
  const partyRole = partyRoleUuid ? findPartyRole(partyRoleUuid) : null;
  const user = me();

  return saveInCollection(
    '/order',
    {
      ...(existing ?? {}),
      uuid: existing?.uuid,
      voucher: voucher ? clone(voucher) : null,
      partyRole,
      branch: (cashRegister?.['branch'] as Row | undefined) ?? null,
      cashRegister: ref(cashRegister),
      dateOperation: (payload['dateOperation'] as string | undefined) ?? nowIso(),
      expiresAt: (payload['expiresAt'] as string | undefined) ?? null,
      publicId: (existing?.['publicId'] as string | undefined) ?? String(MockDb.nextSeq()),
      observations: (payload['observations'] as string | undefined) ?? null,
      receiverName: (payload['receiverName'] as string | undefined) ?? null,
      receiverDocType: (payload['receiverDocType'] as string | undefined) ?? null,
      receiverDocNumber: (payload['receiverDocNumber'] as string | undefined) ?? null,
      receiverTaxCondition: (payload['receiverTaxCondition'] as string | undefined) ?? null,
      items,
      orderCheckout: {
        seller: { uuid: user.uuid, name: user['username'] },
        payments,
        totalAmount: round2(total),
        taxAmount: round2(totalTax),
        discountAmount: 0,
      },
      promotions: [],
      confirmExpiredOverride: null,
      version: existing?.['version'],
    },
  );
}

function findPartyRole(uuid: string): Row | null {
  for (const key of ['/party/customer', '/party/supplier', '/party/employee/seller', '/party/employee/buyer', '/party/employee/transportist']) {
    const row = MockDb.find(key, uuid);
    if (row) {
      const party = (row['party'] as Row | undefined) ?? row;
      return {
        uuid,
        name: party['name'] ?? party['businessName'] ?? row['name'] ?? null,
        docType: party['docType'] ?? null,
        docNumber: party['docNumber'] ?? null,
        role: row['role'] ?? key.split('/').pop()?.toUpperCase() ?? null,
      };
    }
  }
  return { uuid };
}

// ---------------------------------------------------------------------------------------------
// Categorías: el árbol se arma desde una colección plana, así altas y bajas se ven enseguida.
// ---------------------------------------------------------------------------------------------

function categories(): Row[] {
  if (!MockDb.hasCollection('/category') || !MockDb.collection('/category').length) {
    const tree = (MockDb.recorded('GET /category/getAllTree')?.body as Row[] | undefined) ?? [];
    const walk = (nodes: Row[] | null | undefined, parent: Row | null) => {
      for (const node of nodes ?? []) {
        const detail = MockDb.detail('/category', String(node.uuid)) ?? {};
        MockDb.upsert('/category', {
          uuid: node.uuid,
          status: 0,
          dateCreated: detail['dateCreated'] ?? null,
          version: detail['version'] ?? 0,
          name: node['name'],
          parentCategory: parent ? { uuid: parent.uuid, name: parent['name'] } : null,
          categoryAttributes: detail['categoryAttributes'] ?? [],
        });
        walk(node['subCategories'] as Row[] | null, node);
      }
    };
    walk(tree, null);
  }
  return MockDb.collection('/category').filter((c) => c['status'] !== -1);
}

function childrenOf(uuid: string | null): Row[] {
  return categories().filter((c) => ((c['parentCategory'] as Row | null)?.uuid ?? null) === uuid);
}

function categoryNode(category: Row): Row {
  return { uuid: category.uuid, name: category['name'], hasChildren: childrenOf(String(category.uuid)).length > 0 };
}

function categoryTree(parent: string | null): Row[] {
  return childrenOf(parent).map((c) => {
    const sub = categoryTree(String(c.uuid));
    return { uuid: c.uuid, name: c['name'], parentCategory: c['parentCategory'] ?? null, subCategories: sub.length ? sub : null };
  });
}

function categoryAttributes(uuid: string): Row[] {
  const out: Row[] = [];
  let current = categories().find((c) => c.uuid === uuid);
  while (current) {
    out.push(...(((current['categoryAttributes'] as Row[] | undefined) ?? [])));
    const parentUuid = (current['parentCategory'] as Row | null)?.uuid;
    current = parentUuid ? categories().find((c) => c.uuid === parentUuid) : undefined;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------

export const MOCK_ROUTES: MockRoute[] = [
  // Sesión: cualquier credencial entra, y el usuario es el sysadmin grabado de staging.
  route('POST', '/user/login', () => ok({ token: MOCK_TOKEN, refresh: MOCK_TOKEN })),
  route('GET', '/user/login', () => ok(me())),
  route('POST', '/user/refresh-token', () => ok({ token: MOCK_TOKEN, refresh: MOCK_TOKEN })),
  route('POST', '/auth/logout', () => ok({})),
  route('POST', '/auth/change-password', () => ok({})),
  route('POST', '/user/public/forgot-password', () => ok({})),
  route('POST', '/user/public/change-password', () => ok({})),

  // Categorías.
  route('GET', '/category/getAllTree', () => ok(categoryTree(null))),
  route('GET', '/category/parents', () => ok(childrenOf(null).map(categoryNode))),
  route('GET', '/category/children/:uuid', (_req, m) => ok(childrenOf(m[1]).map(categoryNode))),
  route('GET', '/category/attributes/:uuid', (_req, m) => ok(categoryAttributes(m[1]))),
  route('GET', '/category/uuid/:uuid', (_req, m) => {
    const category = categories().find((c) => c.uuid === m[1]);
    if (!category) {
      fail(404, 'NOT_FOUND', 'La categoría no existe.');
    }
    return ok({
      ...clone(category),
      hasChildren: childrenOf(m[1]).length > 0,
      subCategories: childrenOf(m[1]).map(categoryNode),
    });
  }),
  route('POST', '/category/save', (req) => {
    categories();
    const body = (req.body ?? {}) as Row;
    const attributes = ((body['categoryAttributes'] as Row[] | undefined) ?? []).map((a) => ({ uuid: a.uuid ?? newUuid(), status: 0, ...a }));
    return ok(saveInCollection('/category', { ...body, categoryAttributes: attributes }));
  }),
  route('DELETE', '/category/:uuid', (_req, m) => {
    categories();
    const removed = MockDb.remove('/category', m[1]);
    return ok({ ...(removed ?? {}), status: -1 });
  }),

  // Catálogo agrupado por modelo, rearmado a partir de los productos vivos del mock.
  route('POST', '/product/paginate-catalog', (req) => ok(mockPaginate(catalogRows(), req.body as PaginateQuery))),

  route('GET', '/product/by-barcode', (req) => {
    const code = (req.params.get('code') ?? '').trim().toLowerCase();
    const same = (value: unknown) => value != null && String(value).toLowerCase() === code;
    for (const row of MockDb.collection('/product')) {
      if (!row.uuid || row['status'] === -1) {
        continue;
      }
      const product = MockDb.detail('/product', row.uuid) ?? row;
      const barcodes = (product['barcodes'] as Row[] | undefined) ?? [];
      const packagings = (product['packagings'] as Row[] | undefined) ?? [];
      const packaging = packagings.find((p) => same(p['barcode']));
      const barcode = barcodes.find((b) => same(b['barcode']));
      if (packaging) {
        return ok({
          barcode: packaging['barcode'],
          isPrimary: false,
          factor: packaging['factor'],
          packaging: { uuid: packaging.uuid, name: packaging['name'], factor: packaging['factor'] },
          scale: null,
          product,
        });
      }
      if (barcode || same(product['barcode']) || same(product['sku'])) {
        return ok({ barcode: code, isPrimary: barcode?.['isPrimary'] ?? true, factor: 1, packaging: null, scale: null, product });
      }
    }
    fail(404, 'PRODUCT_NOT_FOUND', `Ningún producto se lee con ${code}`);
  }),

  // Terceros.
  route('POST', '/party/search', (req) => {
    const body = (req.body ?? {}) as Row;
    const term = String(body['term'] ?? body['docNumber'] ?? '').toLowerCase();
    const rows = MockDb.collection('/party').filter((party) =>
      JSON.stringify(party).toLowerCase().includes(term),
    );
    return ok(rows.slice(0, 20));
  }),

  // Directorio: alta compuesta de un vínculo (ficha + rol + contactos).
  route('POST', /^\/party\/((?:employee\/)?[a-z]+)\/onboard$/, (req, m) => {
    const link = m[1];
    const body = (req.body ?? {}) as Row;
    const profile = (body['profile'] ?? {}) as Row;
    const roleName = { customer: 'CUSTOMER', supplier: 'SUPPLIER' }[link] ?? link.split('/').pop()!.toUpperCase();
    const existingParty = typeof profile['partyUuid'] === 'string' ? MockDb.find('/party', profile['partyUuid']) : undefined;
    const partyUuid = existingParty?.uuid ?? newUuid();
    const roleUuid = newUuid();
    const contacts = ((body['contacts'] as Row[] | undefined) ?? []).map((c) => ({ uuid: newUuid(), ...c }));
    const party = saveInCollection('/party', {
      ...(existingParty ?? {}),
      uuid: partyUuid,
      name: profile['name'] ?? existingParty?.['name'] ?? null,
      docType: profile['docType'] ?? existingParty?.['docType'] ?? null,
      docNumber: profile['docNumber'] ?? existingParty?.['docNumber'] ?? null,
      taxCondition: profile['taxCondition'] ?? existingParty?.['taxCondition'] ?? null,
      roles: [...(((existingParty?.['roles'] as Row[] | undefined) ?? [])), { uuid: roleUuid, role: roleName, status: 0 }],
      contacts,
      userUuid: null,
      username: null,
      version: existingParty?.['version'],
    });
    MockDb.record(`GET /party/${partyUuid}/contacts`, contacts);
    const role = saveInCollection(`/party/${link}`, {
      ...profile,
      uuid: roleUuid,
      partyUuid,
      name: party['name'],
      docType: party['docType'],
      docNumber: party['docNumber'],
      taxCondition: party['taxCondition'],
      role: roleName,
      contacts,
      userUuid: null,
      username: null,
    });
    return ok(role);
  }),

  // Órdenes.
  route('POST', '/order/commit', (req) => ok(commitOrder((req.body ?? {}) as Row))),
  route('POST', '/order/:uuid/convert', (req, m) => {
    const existing = MockDb.detail('/order', m[1]);
    if (!existing) {
      fail(404, 'ORDER_NOT_FOUND', 'La orden no existe.');
    }
    return ok(commitOrder({ ...(req.body as Row), version: undefined }, { ...existing, version: undefined }));
  }),

  // Cajas: abrir sesión.
  route('POST', '/cash-register/:uuid/open', (req, m) => {
    const register = MockDb.find('/cash-register', m[1]);
    const user = me();
    const session = {
      uuid: newUuid(),
      status: 0,
      dateCreated: nowIso(),
      version: 0,
      openedBy: { uuid: user.uuid, name: user['username'] },
      closedBy: null,
      openedAt: nowIso(),
      closedAt: null,
      openingAmount: Number((req.body as Row | null)?.['openingAmount'] ?? 0),
      expectedCashAmount: null,
      countedCashAmount: null,
      differenceAmount: null,
      sessionState: 'OPEN',
      forceClosed: false,
      forceCloseReason: null,
    };
    if (register) {
      register['openSession'] = session;
      MockDb.upsert('/cash-register', register);
      const entry = MockDb.recorded('GET /cash-register/entry-context')?.body as Row | undefined;
      if (entry && (entry['cashRegister'] as Row | undefined)?.uuid === register.uuid) {
        MockDb.record('GET /cash-register/entry-context', {
          ...entry,
          cashRegister: { ...(entry['cashRegister'] as Row), openSession: session },
          alreadyInSession: true,
        });
      }
    }
    return ok(session);
  }),

  // Configuración: el save pisa el valor efectivo y el nivel correspondiente.
  route('POST', '/configuration/save/list', (req) => {
    const payloads = (req.body as Row[] | null) ?? [];
    for (const key of ['GET /configuration/effective', 'GET /configuration/effective?levels=true']) {
      const effective = clone((MockDb.recorded(key)?.body as Row[] | undefined) ?? []);
      for (const payload of payloads) {
        let setting = effective.find((s) => s['key'] === payload['key']);
        if (!setting) {
          setting = { key: payload['key'], value: null, source: 'DEFAULT' };
          effective.push(setting);
        }
        setting['value'] = payload['value'];
        setting['source'] = payload['value'] === null ? 'DEFAULT' : payload['scope'];
        if (setting['levels'] && typeof setting['levels'] === 'object') {
          (setting['levels'] as Row)[String(payload['scope'])] = payload['value'];
        }
      }
      MockDb.record(key, effective);
    }
    return ok(payloads);
  }),
  route('POST', '/configuration/save', (req) => ok(req.body)),

  // Ajuste manual de stock: declara la cantidad contada.
  route('POST', '/stock/adjustment', (req) => {
    const body = (req.body ?? {}) as Row;
    const productUuid = String((body['product'] as Row | undefined)?.uuid ?? body['productUuid'] ?? '');
    const warehouseUuid = ((body['warehouse'] as Row | undefined)?.uuid ?? body['warehouseUuid'] ?? null) as string | null;
    const distribution = MockDb.recorded(`GET /stock/distribution/${productUuid}`)?.body as Row | undefined;
    const current = ((distribution?.['rows'] as Row[] | undefined) ?? []).find(
      (r) => (r['warehouse'] as Row | undefined)?.uuid === warehouseUuid,
    );
    const counted = Number(body['countedQuantity'] ?? 0);
    const delta = counted - Number(current?.['quantity'] ?? 0);
    adjustStock(productUuid, warehouseUuid, delta);
    return ok({
      uuid: newUuid(),
      movementType: delta >= 0 ? 'INGRESO' : 'EGRESO',
      quantity: Math.abs(delta),
      previousQuantity: Number(current?.['quantity'] ?? 0),
      countedQuantity: counted,
    });
  }),
];
