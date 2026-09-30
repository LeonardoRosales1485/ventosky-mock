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
import {
  CategoryTreeNodeDto,
  toCategoryChains,
  toCategoryOptions,
} from '../../../core/category/category-options';
import { PriceRounding, toPriceRounding } from '../../../core/pricing/price-rounding';
import { availabilityPresetFilter } from '../../../core/product-picker/product-picker.model';
import { ProductLookupApiService } from '../../../core/product/product-lookup-api.service';
import {
  ProductCodeLookup,
  ProductLookupMode,
} from '../../../core/product/product-lookup.model';
import { environment } from '../../../../environments/environment';
import { CashRegisterEntryContextDto, CashRegisterDto } from '../../../core/cash-session/cash-session.model';
import {
  SaleCustomerDto,
  SaleKitInfo,
  SalePaymentMethodDto,
  SalePriceListDto,
  SaleProductDto,
  SaleProductPriceRuleDto,
  SalePromotionDto,
  SaleVoucherDto,
  isSaleVoucher,
} from './sale.model';

/**
 * El detalle del producto, recortado a lo que el POS usa de un kit. Es `ProductDTO` entero del otro
 * lado; acá sólo se declara la composición enriquecida, que es lo único que se lee.
 */
interface SaleProductDetailDto {
  kitAvailability?: number | null;
  kitItems?:
    | readonly {
        component: { uuid: string; name: string };
        quantity?: number | null;
        stock?: number | null;
        limitsAvailability?: boolean | null;
      }[]
    | null;
}

/** Los catálogos del punto de venta son chicos: se traen enteros en vez de paginarlos. */
const OPTIONS_PAGE_SIZE = 500;

/**
 * Cuántas filas se traen por lectura. Un código identifica un producto, así que en la práctica es
 * una: se piden unas pocas para poder distinguir «no existe» de «existe y no se puede vender».
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
export class SalesCatalogApiService {
  private readonly http = inject(HttpClient);
  private readonly lookup = inject(ProductLookupApiService);

  /**
   * Resolución de una lectura del lector (`GET /product/by-barcode`): el producto **más** cuánto
   * carga esa lectura. Cubre los tres casos de un mostrador multirubro sin que la pantalla sepa cuál
   * es antes de escanear: el código del producto, el de una de sus cajas —que vuelve con el factor
   * del empaque— y la etiqueta de balanza, que trae el peso adentro y no se busca entre los códigos
   * de barras (RN-18).
   *
   * Se delega en `core` porque la compra hace exactamente lo mismo, y porque un `*ApiService` de
   * feature no se puede compartir: los proveen sus propias pantallas.
   */
  resolveCode(
    code: string,
    mode?: ProductLookupMode,
  ): Observable<ProductCodeLookup<SaleProductDto>> {
    return this.lookup.resolve<SaleProductDto>(code, mode);
  }

  /**
   * El detalle de un producto (`GET /product/uuid/{uuid}`), con el stock, los precios, los empaques
   * y el costo de la sucursal activa: el mismo `ProductDTO` enriquecido que devuelve la resolución
   * por código, y no el recorte del paginado.
   *
   * Lo necesita la lectura de un número de serie, que resuelve **la unidad** y no el producto: el
   * `/stock/serial` devuelve una referencia —uuid y nombre— y una línea de venta no se arma con eso.
   */
  getProductByUuid(uuid: string): Observable<SaleProductDto> {
    return this.http.get<SaleProductDto>(apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/${uuid}`));
  }

  /**
   * Productos cuyo código de barras o SKU es exactamente `code`, acotados por el backend a la
   * sucursal activa (`X-Branch-Uuid`). Es el paginado operativo y no el catálogo completo: un
   * producto que no está en la sucursal no tiene ni stock ni precio acá, así que tampoco se vende.
   *
   * La coincidencia es exacta y no «contiene»: lo que entra por acá lo escribe un lector láser, y
   * un prefijo puede ser el código de otro producto. Se usa `LIKE` / `ILIKE` sin comodines —una
   * igualdad que ignora mayúsculas— porque el lector manda el código tal cual está guardado, pero
   * un SKU tipeado a mano no tiene por qué respetar la caja.
   *
   * Devuelve las filas sin filtrar por `isForSale`: la pantalla necesita poder distinguir un código
   * inexistente de uno que existe pero la empresa marcó como no vendible.
   */
  findProductsByCode(code: string): Observable<SaleProductDto[]> {
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
      .post<PaginationData<SaleProductDto>>(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE), query)
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * Productos de la sucursal activa cuyo **nombre**, SKU o código de barras contiene `term`: las
   * opciones del autocompletado con las que se carga a mano, sin lector.
   *
   * Al revés de {@link findProductsByCode}, acá la coincidencia es parcial —se está tipeando, no
   * escaneando— y el catálogo llega ya acotado a lo vendible: como el producto se elige de una
   * lista, uno que la empresa marcó como no vendible no es una opción que valga la pena ofrecer
   * para después rechazarla.
   */
  searchSellableProducts(term: string): Observable<SaleProductDto[]> {
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

    // Los grupos se combinan con AND: (nombre O sku O código) Y vendible.
    const sellableGroup = availabilityPresetFilter('sale');

    const query: PaginateQuery = {
      page: 1,
      size: SUGGESTION_PAGE_SIZE,
      filtros: sellableGroup ? [termGroup, sellableGroup] : [termGroup],
      ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
    };

    return this.http
      .post<PaginationData<SaleProductDto>>(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE), query)
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * Clientes de la empresa, ordenados por nombre. Desde que el cliente se elige en su propio
   * selector paginado, la pantalla usa esta lectura para una sola cosa: resolver con quién arranca
   * la venta —el consumidor final—. Se sigue trayendo entera porque el backend todavía no ofrece
   * cómo pedir ese cliente solo.
   *
   * El orden apunta a `parties` y no a `t`: el paginado de clientes corre sobre `party_roles`, y
   * desde la unificación de terceros el nombre vive un nivel más arriba, en la identidad. Pedirlo
   * como `t.name` es un `400` —la columna no existe— y la venta arranca sin poder resolver con
   * quién.
   */
  getCustomers(): Observable<SaleCustomerDto[]> {
    return this.paginateAll<SaleCustomerDto>(API_ENDPOINTS.CUSTOMERS.PAGINATE, 'parties');
  }

  /**
   * Los comprobantes de **venta** de la empresa.
   *
   * Se acota por `operationType` y no por los efectos: `SALE_X` y `PURCHASE_CREDIT_NOTE` declaran
   * los mismos (`DECREMENT` de stock, `INCREMENT` de balance), así que hasta `v73` no había con qué
   * separarlos y el mostrador ofrecía el catálogo entero. Ahora el sentido lo declara el propio
   * comprobante y el commit lo valida contra la contraparte: uno de compra con un cliente responde
   * 400, así que ofrecerlo sería ofrecer un error.
   */
  getVouchers(): Observable<SaleVoucherDto[]> {
    return this.paginateAll<SaleVoucherDto>(API_ENDPOINTS.VOUCHERS.PAGINATE).pipe(
      map((vouchers) => vouchers.filter(isSaleVoucher)),
    );
  }

  /** Medios de pago visibles para la empresa: los globales más los personalizados propios. */
  getPaymentMethods(): Observable<SalePaymentMethodDto[]> {
    return this.paginateAll<SalePaymentMethodDto>(API_ENDPOINTS.PAYMENT_METHODS.PAGINATE);
  }

  /**
   * Listas activas de la empresa. La pantalla sólo necesita cuál es la principal —para el fallback
   * de precio— y el nombre de la que terminó aplicando.
   */
  getPriceLists(): Observable<SalePriceListDto[]> {
    return this.paginateAll<SalePriceListDto>(API_ENDPOINTS.PRICE_LISTS.PAGINATE).pipe(
      map((lists) => lists.filter((list) => list.isCost !== true && list.isActive !== false)),
    );
  }

  /**
   * Las promociones de la empresa, **de la más antigua a la más nueva**.
   *
   * El orden es el dato: es lo que desempata dos NxM de igual fracción bonificada y dos no
   * acumulables de igual descuento. Del otro lado ese desempate es el id de la fila; acá la fecha de
   * alta es lo más cerca que se puede estar de él.
   *
   * No se filtra por estado: entran discontinuadas y vencidas, y descarta el motor. Es el mismo
   * criterio de vigencia que corre el backend en el commit, y filtrar acá con otro —el `state` que
   * calcula el paginado contra **su** hoy— haría que una promoción que vence hoy se apague a horas
   * distintas de cada lado.
   *
   * Una sola página de {@link OPTIONS_PAGE_SIZE}, como el resto de los catálogos de esta pantalla:
   * pasado ese techo se pierden filas en silencio. Acá duele un poco más que en los otros, porque el
   * orden por fecha de alta es el desempate y las que se caen son las más nuevas.
   *
   * Exige `promotion.view` (`PromotionController.hookPaginateAuth`). Sin el permiso la lectura
   * responde 403 y el POS se queda sin anticipar los descuentos: el commit los aplica igual, así que
   * el total que se cobró termina siendo mayor que el que se registró. Es una decisión del backend
   * —el vendedor no necesita el permiso para que las promociones se apliquen— y el mostrador no
   * tiene cómo compensarla; lo que puede hacer el front es no romperse.
   */
  getPromotions(): Observable<SalePromotionDto[]> {
    return this.http
      .post<PaginationData<SalePromotionDto>>(apiUrl(API_ENDPOINTS.PROMOTIONS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'date_created', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * El linaje de cada categoría de la empresa, con el que una promoción cargada sobre una categoría
   * alcanza a todo su subárbol. Es el mismo árbol que lee el ABM; acá sólo interesa el parentesco.
   */
  getCategoryChains(): Observable<ReadonlyMap<string, readonly string[]>> {
    return this.http
      .get<CategoryTreeNodeDto[]>(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE))
      .pipe(map((tree) => toCategoryChains(toCategoryOptions(tree ?? []))));
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
   * ancestros).
   *
   * Devuelve `null` cuando no hay criterio propio que aplicar, y el carrito cae a los defaults —dos
   * decimales, al más cercano—, que es exactamente lo que hace el backend cuando el producto no
   * tiene regla. Pasa en los tres casos que no se distinguen entre sí ni hace falta distinguir: sin
   * regla el backend responde `204`; sin `price_rule.view` responde `403`; y si la lectura falla,
   * anticipar con el default es mejor que no mostrar importes.
   */
  getProductRounding(productUuid: string): Observable<PriceRounding | null> {
    return this.http
      .get<SaleProductPriceRuleDto | null>(
        apiUrl(`${API_ENDPOINTS.PRICE_RULES.BY_PRODUCT}/${productUuid}`),
      )
      .pipe(
        map((rule) => (rule ? toPriceRounding(rule.roundingMode, rule.roundingDirection) : null)),
        catchError(() => of(null)),
      );
  }

  /**
   * Composición y disponible derivado de un kit (`GET /product/uuid/{uuid}`).
   *
   * Se pide **al agregarlo al carrito** y no en el paginado: derivar el disponible de cada kit por
   * fila costaría una consulta por combo en cada página del buscador, y el mostrador escanea de a
   * uno. Es el mismo criterio que el redondeo por producto, y se cachea igual.
   *
   * Un error deja el kit sin despliegue y sin disponible anticipado: la venta se manda igual y el
   * backend valida componente por componente, que es quien tiene la verdad.
   */
  getKitInfo(productUuid: string): Observable<SaleKitInfo | null> {
    return this.http
      .get<SaleProductDetailDto>(apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/${productUuid}`))
      .pipe(
        map((product) => ({
          availability: product?.kitAvailability ?? null,
          components: (product?.kitItems ?? []).map((row) => ({
            uuid: row.component.uuid,
            name: row.component.name,
            quantity: row.quantity ?? 0,
            stock: row.stock ?? null,
            // El componente sin control de existencias no limita el disponible del kit (RN-07).
            limitsAvailability: row.limitsAvailability === true,
          })),
        })),
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
