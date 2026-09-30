import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import {
  FilterMatchMode,
  PaginateFiltro,
  PaginateQuery,
  PaginationData,
  escapeLikeWildcards,
  formatPatternFilterValor,
  getOperacionFromFilterMatchMode,
  resolvePaginateSqlDialectConfig,
} from '../../../core/paginate';
import { PriceRounding, toPriceRounding } from '../../../core/pricing/price-rounding';
import {
  SUPPLIER_PICKER_RELATIONS,
  availabilityFilterGroups,
  supplierFilterGroups,
} from '../../../core/product-picker/product-picker.model';
import {
  CashRegisterDto,
  CashRegisterEntryContextDto,
} from '../../../core/cash-session/cash-session.model';
import { environment } from '../../../../environments/environment';
import {
  PurchaseModelDto,
  PurchasePaymentMethodDto,
  PurchaseProductDetailDto,
  PurchaseProductDto,
  PurchaseProductPriceRuleDto,
  PurchaseSupplierDto,
  PurchaseVoucherDto,
  isPurchaseVoucher,
} from './purchase.model';
import { ProductLookupApiService } from '../../../core/product/product-lookup-api.service';
import {
  ProductCodeLookup,
  ProductLookupMode,
} from '../../../core/product/product-lookup.model';

/** Los catálogos de la pantalla son chicos: se traen enteros en vez de paginarlos. */
const OPTIONS_PAGE_SIZE = 500;

/**
 * Cuántas filas se traen por lectura. Un código identifica un producto, así que en la práctica es
 * una: se piden unas pocas para poder distinguir «no existe» de «existe y no se puede comprar».
 */
const CODE_LOOKUP_PAGE_SIZE = 5;

/** Lo único con lo que un lector puede identificar un producto. El nombre no entra acá. */
const CODE_COLUMNS = ['barcode', 'sku'] as const;

/**
 * Cuántas sugerencias trae el autocompletado. Es una lista para elegir de un vistazo y no un
 * listado: si el producto no está entre las primeras, lo que hace falta es el selector avanzado.
 */
const SUGGESTION_PAGE_SIZE = 8;

/** Con qué se reconoce un producto cuando se lo busca tipeando. Acá el nombre sí entra. */
const SUGGESTION_COLUMNS = ['name', 'sku', 'barcode'] as const;

/** Desde cuántos caracteres tiene sentido preguntarle al backend. */
export const PRODUCT_SUGGESTION_MIN_LENGTH = 2;

/** El `LIKE` / `ILIKE` lo decide el motor del backend, no esta pantalla. */
const SQL_DIALECT = resolvePaginateSqlDialectConfig(environment.paginateSqlDialect);

@Injectable()
export class PurchasesCatalogApiService {
  private readonly http = inject(HttpClient);
  private readonly lookup = inject(ProductLookupApiService);

  /**
   * Resolución de una lectura del lector (`GET /product/by-barcode`): el producto **más** cuánto
   * carga esa lectura. Es el caso central del empaque —escanear el bulto carga las 1000 unidades que
   * trae— y cubre además la etiqueta de balanza, que no se busca entre los códigos de barras
   * (RN-18).
   *
   * Se delega en `core` porque el punto de venta hace exactamente lo mismo, y porque un
   * `*ApiService` de feature no se puede compartir: los proveen sus propias pantallas.
   */
  resolveCode(
    code: string,
    mode?: ProductLookupMode,
  ): Observable<ProductCodeLookup<PurchaseProductDto>> {
    return this.lookup.resolve<PurchaseProductDto>(code, mode);
  }

  /**
   * Productos cuyo código de barras o SKU es exactamente `code`, acotados por el backend a la
   * sucursal activa (`X-Branch-Uuid`).
   *
   * La coincidencia es exacta y no «contiene»: lo que entra por acá lo escribe un lector láser, y un
   * prefijo puede ser el código de otro producto. Se usa `LIKE` / `ILIKE` sin comodines —una
   * igualdad que ignora mayúsculas— porque el lector manda el código tal cual está guardado, pero un
   * SKU tipeado a mano no tiene por qué respetar la caja.
   *
   * Devuelve las filas sin filtrar por `isForPurchase` ni por kit: la pantalla necesita poder
   * distinguir un código inexistente de uno que existe y no se puede comprar, que se resuelven de
   * maneras distintas. El `type` viene en el paginado, así que alcanza para nombrar el motivo.
   */
  findProductsByCode(code: string): Observable<PurchaseProductDto[]> {
    const valor = escapeLikeWildcards(code.trim());

    const codeGroup: PaginateFiltro[] = CODE_COLUMNS.map((columna) => ({
      tabla: 't',
      columna,
      operacion: SQL_DIALECT.caseInsensitiveLike,
      valor,
    }));

    const query: PaginateQuery = {
      page: 1,
      size: CODE_LOOKUP_PAGE_SIZE,
      filtros: [codeGroup],
      ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
    };

    return this.http
      .post<PaginationData<PurchaseProductDto>>(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE), query)
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * Productos de la sucursal activa cuyo **nombre**, SKU o código de barras contiene `term`: las
   * opciones del autocompletado con las que se carga a mano, sin lector.
   *
   * Al revés de {@link findProductsByCode}, acá la coincidencia es parcial —se está tipeando, no
   * escaneando— y el catálogo llega ya acotado a lo comprable: como el producto se elige de una
   * lista, uno que la empresa marcó como no comprable no es una opción que valga la pena ofrecer
   * para después rechazarla. Por lo mismo quedan afuera los **kits**: no se compran en ninguno de
   * sus dos modos y el commit los rechaza con `KIT_NOT_PURCHASABLE`.
   *
   * Con `supplierUuid` se acota además a los productos vinculados a ese proveedor: es el filtro
   * que la pantalla pone sola al elegirlo y que se puede sacar desde el propio campo. Son JOIN que
   * manda el cliente, no un endpoint aparte — el backend no impone el vínculo, y una compra a un
   * proveedor al que todavía no se le cargó nada tiene que poder cargarse igual.
   */
  searchPurchasableProducts(
    term: string,
    supplierUuid?: string | null,
  ): Observable<PurchaseProductDto[]> {
    const operacion = getOperacionFromFilterMatchMode(FilterMatchMode.Contains, SQL_DIALECT);
    const valor = formatPatternFilterValor(
      escapeLikeWildcards(term.trim()),
      FilterMatchMode.Contains,
    );

    const termGroup: PaginateFiltro[] = SUGGESTION_COLUMNS.map((columna) => ({
      tabla: 't',
      columna,
      operacion,
      valor,
    }));

    // Los grupos se combinan con AND: (nombre O sku O código) Y comprable Y no-kit Y —si hay
    // proveedor elegido y el filtro puesto— provisto por él.
    const purchasableGroups = availabilityFilterGroups('purchase');
    const supplierGroups = supplierUuid ? supplierFilterGroups(supplierUuid) : [];

    const query: PaginateQuery = {
      page: 1,
      size: SUGGESTION_PAGE_SIZE,
      filtros: [termGroup, ...purchasableGroups, ...supplierGroups],
      ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      // Los JOIN sólo se emiten cuando un filtro nombra la tabla, así que sin proveedor no cuestan.
      relaciones: supplierUuid ? [...SUPPLIER_PICKER_RELATIONS] : undefined,
    };

    return this.http
      .post<PaginationData<PurchaseProductDto>>(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE), query)
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * Los productos de un puñado de uuids, en una sola lectura.
   *
   * La usa la edición para reconstruir las líneas de una orden ya guardada: la línea trae el
   * producto reducido a `uuid` + `name`, y el carrito necesita además la precisión de la cantidad
   * —sin ella un producto que se compra de a medio kilo entraría redondeado a 1— y el stock que la
   * grilla muestra al costado.
   *
   * No se filtra por comprable: el producto ya está en la orden, y esconderlo porque hoy no se
   * compra dejaría la línea sin poder editarse. Un uuid que no vuelve —dado de baja, de otra
   * sucursal— simplemente no está en el resultado, y quien llama decide qué hacer con eso.
   */
  getProductsByUuid(uuids: readonly string[]): Observable<PurchaseProductDto[]> {
    if (uuids.length === 0) {
      return of([]);
    }

    const query: PaginateQuery = {
      page: 1,
      size: uuids.length,
      filtros: [
        [
          {
            tabla: 't',
            columna: 'uuid',
            operacion: getOperacionFromFilterMatchMode(FilterMatchMode.In, SQL_DIALECT),
            // El `in` del backend recibe la lista como JSON, no como CSV.
            valor: JSON.stringify([...uuids]),
          },
        ],
      ],
    };

    return this.http
      .post<PaginationData<PurchaseProductDto>>(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE), query)
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * El costo actual del producto en la sucursal, con el que se prellena la línea.
   *
   * Sale del detalle y no del paginado porque el paginado excluye la lista reservada `Costo` de
   * `priceListEntries`. Es una lectura por producto agregado, memoizada por la pantalla.
   *
   * Cae a `null` ante cualquier error: no poder proponer un costo no es motivo para no dejar cargar
   * la compra — el operador lo escribe igual, que es lo que el backend espera de todos modos.
   */
  getProductDetail(productUuid: string): Observable<PurchaseProductDetailDto | null> {
    return this.http
      .get<PurchaseProductDetailDto | null>(
        apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/${productUuid}`),
      )
      .pipe(catchError(() => of(null)));
  }

  /**
   * Proveedores del select, ordenados por nombre.
   *
   * El orden apunta a `parties` y no a `t`: el paginado de proveedores corre sobre `party_roles`, y
   * desde la unificación de terceros el nombre vive un nivel más arriba, en la identidad. Pedirlo
   * como `t.name` es un `400` —la columna no existe— y el select queda vacío.
   */
  getSuppliers(): Observable<PurchaseSupplierDto[]> {
    return this.paginateAll<PurchaseSupplierDto>(API_ENDPOINTS.SUPPLIERS.PAGINATE, 'parties');
  }

  /**
   * Los comprobantes de **compra** de la empresa.
   *
   * Se acota por `operationType` y no por los efectos: `PURCHASE_X` y `SALE_CREDIT_NOTE` declaran los
   * mismos (`INCREMENT` de stock, `DECREMENT` de balance), así que los efectos no alcanzan para
   * separarlos. El sentido lo declara el propio comprobante y el commit lo valida contra la
   * contraparte: uno de venta con un proveedor responde 400, así que ofrecerlo sería ofrecer un
   * error.
   */
  getVouchers(): Observable<PurchaseVoucherDto[]> {
    return this.paginateAll<PurchaseVoucherDto>(API_ENDPOINTS.VOUCHERS.PAGINATE).pipe(
      map((vouchers) => vouchers.filter(isPurchaseVoucher)),
    );
  }

  /**
   * Los modelos del catálogo de la empresa (`POST /product-model/paginate`), ordenados por nombre:
   * lo que ofrece el desplegable de la carga por modelo (§5.6, wireframe `1p`).
   *
   * Son de la empresa y no de la sucursal —el modelo sólo agrupa (RN-12)—: qué variantes tiene **en
   * esta sucursal** se resuelve al elegirlo, con el paginado operativo. Pide `productmodel.view`;
   * sin él la respuesta es un 403, que el diálogo explica en su lugar en vez de mostrar un
   * desplegable vacío.
   */
  getModels(): Observable<PurchaseModelDto[]> {
    return this.paginateAll<PurchaseModelDto>(API_ENDPOINTS.PRODUCT_MODELS.PAGINATE);
  }

  /** Medios de pago visibles para la empresa: los globales más los personalizados propios. */
  getPaymentMethods(): Observable<PurchasePaymentMethodDto[]> {
    return this.paginateAll<PurchasePaymentMethodDto>(API_ENDPOINTS.PAYMENT_METHODS.PAGINATE);
  }

  /** Cajas de la empresa, con su sesión abierta si la tienen. */
  getCashRegisters(): Observable<CashRegisterDto[]> {
    return this.paginateAll<CashRegisterDto>(API_ENDPOINTS.CASH_REGISTERS.PAGINATE);
  }

  /** A qué caja entrar según la preasignación del usuario en la sucursal activa. */
  getCashRegisterEntryContext(): Observable<CashRegisterEntryContextDto> {
    return this.http.get<CashRegisterEntryContextDto>(
      apiUrl(API_ENDPOINTS.CASH_REGISTERS.ENTRY_CONTEXT),
    );
  }

  /**
   * Con qué criterio redondear los importes de un producto: el que declara la regla de precio que lo
   * alcanza en la sucursal activa (`GET /price-rule/product/{uuid}`, resuelta producto → categoría →
   * ancestros). Es el mismo criterio con el que el backend redondea el costo declarado al cerrar la
   * compra.
   *
   * Devuelve `null` cuando no hay criterio propio que aplicar, y el carrito cae a los defaults —dos
   * decimales, al más cercano—, que es exactamente lo que hace el backend cuando el producto no
   * tiene regla. Pasa en los tres casos que no se distinguen entre sí ni hace falta distinguir: sin
   * regla el backend responde `204`; sin `price_rule.view` responde `403`; y si la lectura falla,
   * anticipar con el default es mejor que no mostrar importes.
   */
  getProductRounding(productUuid: string): Observable<PriceRounding | null> {
    return this.http
      .get<PurchaseProductPriceRuleDto | null>(
        apiUrl(`${API_ENDPOINTS.PRICE_RULES.BY_PRODUCT}/${productUuid}`),
      )
      .pipe(
        map((rule) => (rule ? toPriceRounding(rule.roundingMode, rule.roundingDirection) : null)),
        catchError(() => of(null)),
      );
  }

  /**
   * Un catálogo entero, ordenado por nombre.
   *
   * `orderTable` es de dónde sale ese nombre: casi siempre la tabla del propio recurso (`t`), pero
   * los terceros lo tienen en `parties` porque su paginado corre sobre `party_roles`. Nombrar la
   * tabla equivocada no devuelve un orden distinto: devuelve un `400` del generador SQL.
   */
  private paginateAll<T>(endpoint: string, orderTable = 't'): Observable<T[]> {
    return this.http
      .post<PaginationData<T>>(apiUrl(endpoint), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: orderTable, columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }
}
