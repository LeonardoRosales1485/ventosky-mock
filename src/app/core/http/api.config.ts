import { environment } from '../../../environments/environment';

/**
 * Base path of the API. Relative on purpose: the dev server proxies `/api` to
 * the API (`proxy.conf.json`) and nginx reverse-proxies it in production, so
 * the browser never needs to know the API host.
 */
export const API_URL = environment.apiUrl;

/**
 * Endpoint paths, grouped by the feature that owns them.
 */
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/user/login',
    LOGOUT: '/auth/logout',
    REFRESH_TOKEN: '/user/refresh-token',
    CHANGE_PASSWORD: '/auth/change-password',
    ME: '/user/login',
    REQUEST_PASSWORD_RESET: '/user/public/forgot-password',
    RESET_PASSWORD: '/user/public/change-password',
  },
  USERS: {
    PAGINATE: '/user/paginate',
    SAVE: '/user/save',
    BY_UUID: '/user/uuid',
    DELETE: '/user',
  },
  ROLES: {
    PAGINATE: '/role/paginate',
    SAVE: '/role/save',
    BY_UUID: '/role/uuid',
    DELETE: '/role',
  },
  BRANDS: {
    PAGINATE: '/brand/paginate',
    SAVE: '/brand/save',
    BY_UUID: '/brand/uuid',
    DELETE: '/brand',
  },
  /**
   * Catálogo de ejes de variante (Talle, Color, Capacidad) y sus valores. Son de la **empresa**, no
   * del modelo: se escriben una vez y se reusan en todos los modelos. El eje y sus valores se
   * guardan en un solo `save`, porque en la pantalla son una sola tarea.
   */
  PRODUCT_OPTIONS: {
    PAGINATE: '/product-option/paginate',
    SAVE: '/product-option/save',
    BY_UUID: '/product-option/uuid',
    DELETE: '/product-option',
  },
  /**
   * Modelos y su matriz de variantes. Un `save` acá crea o actualiza **N productos**: la variante es
   * un producto (RN-11) y el modelo sólo agrupa —no cotiza ni tiene stock (RN-12)—.
   */
  PRODUCT_MODELS: {
    PAGINATE: '/product-model/paginate',
    SAVE: '/product-model/save',
    BY_UUID: '/product-model/uuid',
    DELETE: '/product-model',
  },
  PRODUCTS: {
    PAGINATE: '/product/paginate',
    /**
     * Catálogo agrupado por modelo: una fila por modelo con variantes vivas y una por producto
     * suelto. La unidad de la página es la **fila del catálogo**, no el producto — agrupar en el
     * cliente partía un modelo de dieciséis variantes entre páginas y lo repetía en cada una.
     */
    PAGINATE_CATALOG: '/product/paginate-catalog',
    /** Catálogo completo de la empresa, sin acotar por sucursal (pantalla de administración). */
    PAGINATE_ALL: '/product/paginate-all',
    SAVE: '/product/save',
    BY_UUID: '/product/uuid',
    /** Resolución de un código de barras (principal o alternativo) al producto: `?code=`. */
    BY_BARCODE: '/product/by-barcode',
    DELETE: '/product',
  },
  PRICE_LISTS: {
    PAGINATE: '/price-list/paginate',
    SAVE: '/price-list/save',
    BY_UUID: '/price-list/uuid',
    DELETE: '/price-list',
    /** Listas con precio del producto en la sucursal activa, con ese precio. */
    BY_PRODUCT: '/price-list/product',
  },
  PRICE_RULES: {
    PAGINATE: '/price-rule/paginate',
    SAVE: '/price-rule/save',
    BY_UUID: '/price-rule/uuid',
    DELETE: '/price-rule',
    /** Regla efectiva de un producto en la sucursal activa (producto → categoría → ancestros). */
    BY_PRODUCT: '/price-rule/product',
  },
  /**
   * Promociones. Los cinco endpoints heredados y nada más: **no hay endpoint de discontinuar ni de
   * reactivar** —son una edición con `isDiscontinued`— y archivar es el `DELETE`.
   */
  PROMOTIONS: {
    PAGINATE: '/promotion/paginate',
    SAVE: '/promotion/save',
    BY_UUID: '/promotion/uuid',
    DELETE: '/promotion',
  },
  /**
   * Serie temporal de los cambios de precio, de solo lectura: la escribe el backend en cada
   * cambio (`MANUAL`, recálculo por regla, edición de la lista) y `/save` y `/delete` responden
   * `400`. La curva se identifica por la terna producto + lista + sucursal.
   */
  PRICE_HISTORY: {
    PAGINATE: '/price-history/paginate',
    BY_UUID: '/price-history/uuid',
  },
  CATEGORIES: {
    GET_ALL_TREE: '/category/getAllTree',
    PARENTS: '/category/parents',
    CHILDREN: '/category/children',
    /** Atributos efectivos de una categoría: los propios más los heredados de sus ancestros. */
    ATTRIBUTES: '/category/attributes',
    SAVE: '/category/save',
    BY_UUID: '/category/uuid',
    DELETE: '/category',
  },
  /**
   * Maestro de terceros. Clientes y proveedores son dos **roles** de la misma identidad, así que
   * comparten tabla y se separan por path: el permiso queda como función de la ruta y no del cuerpo
   * del request.
   */
  PARTIES: {
    /** Busca sobre todo el maestro, sin filtrar por rol: es lo que necesita el alta. */
    SEARCH: '/party/search',
    /** Todo el maestro, con los roles de cada ficha: la carpeta «Todos» del directorio. */
    PAGINATE: '/party/paginate',
    BY_UUID: '/party/uuid',
    /** `GET /party/{uuid}/contacts`. */
    CONTACTS: '/party',
    CONTACT_SAVE: '/party/contact/save',
    CONTACT_DELETE: '/party/contact',
    /**
     * `POST` vincula la ficha con su usuario —uno nuevo o uno que ya existe— y le otorga roles en la
     * empresa activa; `DELETE` la desvincula **sin sacarle el acceso**, que es editar el usuario.
     */
    USER: (partyUuid: string) => `/party/${partyUuid}/user`,
    /**
     * Qué vínculos del directorio son unos roles o permisos, con el porqué de cada uno: los que el alta y
     * «Dar acceso» tienen que cargar con sus datos. Lo decide el backend, con la firma de permisos de cada vínculo.
     */
    DIRECTORY_LINKS_DETECT: '/party/directory-links/detect',
  },
  /**
   * Fusión de terceros duplicados. Los tres endpoints son la misma operación en tres momentos: qué
   * se puede fusionar, qué pasaría y hacerlo. El paginado de `/party/merge/paginate` es la historia.
   */
  CHECKING_ACCOUNT_OPENING: {
    PREVIEW: '/checking-account/opening-balance/preview',
    IMPORT: '/checking-account/opening-balance/import',
    PAGINATE: '/checking-account/opening-balance/paginate',
  },
  PARTY_MERGE: {
    CANDIDATES: '/party/merge/candidates',
    PREVIEW: '/party/merge/preview',
    EXECUTE: '/party/merge/execute',
    PAGINATE: '/party/merge/paginate',
  },
  /*
   * Los cinco vínculos del directorio —cliente, proveedor y los tres tipos de empleado— tienen el
   * mismo juego de endpoints: el ABM del Core, más `ONBOARD` (el alta compuesta: la ficha, sus
   * contactos, los campos extra y el usuario en una transacción) y `SUGGESTED_ROLES` (los roles que el
   * bloque de acceso sugiere para ese vínculo).
   */
  CUSTOMERS: {
    PAGINATE: '/party/customer/paginate',
    SAVE: '/party/customer/save',
    BY_UUID: '/party/customer/uuid',
    DELETE: '/party/customer',
    ONBOARD: '/party/customer/onboard',
    SUGGESTED_ROLES: '/party/customer/suggested-roles',
  },
  SUPPLIERS: {
    PAGINATE: '/party/supplier/paginate',
    SAVE: '/party/supplier/save',
    BY_UUID: '/party/supplier/uuid',
    DELETE: '/party/supplier',
    ONBOARD: '/party/supplier/onboard',
    SUGGESTED_ROLES: '/party/supplier/suggested-roles',
  },
  SELLERS: {
    PAGINATE: '/party/employee/seller/paginate',
    SAVE: '/party/employee/seller/save',
    BY_UUID: '/party/employee/seller/uuid',
    /** Revoca la especialidad de vendedor: el empleado y sus otras especialidades quedan. */
    DELETE: '/party/employee/seller',
    ONBOARD: '/party/employee/seller/onboard',
    SUGGESTED_ROLES: '/party/employee/seller/suggested-roles',
  },
  /** El comprador: sin datos propios, así que su ficha es la del empleado —legajo, ingreso y sucursal—. */
  BUYERS: {
    PAGINATE: '/party/employee/buyer/paginate',
    SAVE: '/party/employee/buyer/save',
    BY_UUID: '/party/employee/buyer/uuid',
    DELETE: '/party/employee/buyer',
    ONBOARD: '/party/employee/buyer/onboard',
    SUGGESTED_ROLES: '/party/employee/buyer/suggested-roles',
  },
  TRANSPORTISTS: {
    PAGINATE: '/party/employee/transportist/paginate',
    SAVE: '/party/employee/transportist/save',
    BY_UUID: '/party/employee/transportist/uuid',
    DELETE: '/party/employee/transportist',
    ONBOARD: '/party/employee/transportist/onboard',
    SUGGESTED_ROLES: '/party/employee/transportist/suggested-roles',
  },
  /**
   * La ficha general del empleado. Lista a todos y edita lo que ninguna ficha de tipo pregunta
   * —egreso, modalidad, alta fiscal, comisión y campos extra—, pero **no da de alta**: no hay empleado
   * genérico, y un alta por acá responde `400 EMPLOYEE_SPECIALTY_REQUIRED`.
   */
  EMPLOYEES: {
    PAGINATE: '/party/employee/paginate',
    SAVE: '/party/employee/save',
    BY_UUID: '/party/employee/uuid',
    /** Da de baja al empleado entero, con sus especialidades y sus campos extra. */
    DELETE: '/party/employee',
    /** Las especialidades vigentes, con los datos de cada una. */
    SPECIALTIES: (uuid: string) => `/party/employee/${uuid}/specialties`,
    /** Otorga una especialidad; revocada antes, revive con los datos que tenía. */
    GRANT_SPECIALTY: (uuid: string) => `/party/employee/${uuid}/specialty`,
    /** Reemplaza el set completo de campos extra: lo que no viene se da de baja. */
    ATTRIBUTES: (uuid: string) => `/party/employee/${uuid}/attributes`,
  },
  /**
   * Catálogo de campos extra de empleado. Borrar un campo da de baja sus valores en todos los
   * empleados; los valores se completan desde la ficha del empleado, no desde acá.
   */
  EMPLOYEE_ATTRIBUTES: {
    PAGINATE: '/employee-attribute/paginate',
    SAVE: '/employee-attribute/save',
    BY_UUID: '/employee-attribute/uuid',
    DELETE: '/employee-attribute',
  },
  /**
   * Cuenta corriente. Una por rol de tercero, y el paginado abarca toda la empresa.
   *
   * `SAVE` sólo **edita** —hoy, el `enabled`—: la cuenta la abre el backend junto con el rol, así
   * que un alta manual responde `400`.
   */
  CHECKING_ACCOUNTS: {
    PAGINATE: '/checking-account/paginate',
    BY_UUID: '/checking-account/uuid',
    BY_PARTY_ROLE: '/checking-account/party-role',
    SAVE: '/checking-account/save',
    /** `POST /checking-account/{uuid}/statement` — el uuid va en el medio. */
    STATEMENT: '/checking-account',
    /** `POST /checking-account/{uuid}/debts` — ídem. */
    DEBTS: '/checking-account',
    /** `POST` registra el cobro o el pago; el mismo path con `/paginate` es el listado. */
    CREDIT: '/checking-account/credit',
    CREDIT_PAGINATE: '/checking-account/credit/paginate',
    /** Qué haría la imputación automática con un importe, sin escribir nada. */
    CREDIT_PREVIEW: '/checking-account/credit/preview',
    /** El historial de prórrogas. Se pagina filtrando por `debtUuid`, que el backend traduce. */
    DEBT_EXTENSION_PAGINATE: '/checking-account/debt-extension/paginate',
    /** El libro de imputaciones. `/{uuid}/reverse`, `/reassign` y `/trace` cuelgan de acá. */
    ALLOCATION: '/checking-account/allocation',
    ALLOCATION_PAGINATE: '/checking-account/allocation/paginate',
    /**
     * La política de la empresa. `GET` la lee —nunca da 404: sin fila devuelve los defaults— y
     * `/save` la escribe, con un upsert por nivel: no lleva `uuid`.
     */
    POLICY: '/checking-account/policy',
    POLICY_SAVE: '/checking-account/policy/save',
    /** Qué pasaría si se guardara una política, sin escribir nada. */
    POLICY_PREVIEW: '/checking-account/policy/preview',
    /**
     * El override de un titular y su historial de morosidad: los dos cuelgan de la cuenta, así que
     * el uuid va en el medio — `/checking-account/{uuid}/policy` y `/{uuid}/delinquency`.
     */
    ACCOUNT_POLICY_SUFFIX: '/policy',
    DELINQUENCY_SUFFIX: '/delinquency',
    /**
     * El disponible del titular, con la decisión del portón ya tomada. Cuelga de `BY_PARTY_ROLE` y
     * no de la cuenta porque el mostrador conoce el rol y no el uuid de la cuenta corriente:
     * `GET /checking-account/party-role/{uuid}/availability`.
     */
    AVAILABILITY_SUFFIX: '/availability',
    /**
     * El ajuste manual del saldo. **No cuelga de la cuenta** como la morosidad: acepta las dos formas
     * de nombrar al titular —la cuenta o su rol—, así que el uuid viaja en el cuerpo.
     */
    ADJUSTMENT: '/checking-account/adjustment',
    /**
     * La prórroga cuelga de la **deuda**, no de la cuenta:
     * `POST /checking-account/debt/{uuid}/extend`.
     */
    DEBT: '/checking-account/debt',
    EXTEND_SUFFIX: '/extend',
    /**
     * El aviso de deuda cuelga de la cuenta: `POST /checking-account/{uuid}/notice`, y con
     * `/preview` la propuesta que el operador revisa antes de mandarla.
     */
    NOTICE_SUFFIX: '/notice',
    PREVIEW_SUFFIX: '/preview',
    /**
     * Recalcular los caches de una cuenta —saldo y nivel— a mano. Es la contraparte del job de
     * consistencia, que detecta y **no** corrige.
     */
    RECALCULATE_SUFFIX: '/recalculate',
    /**
     * La verificación de los caches contra las partidas, sobre **toda la empresa**. Detecta y no
     * corrige: deja una fila por diferencia, y sella la fecha aunque no encuentre ninguna.
     */
    CONSISTENCY_RUN: '/checking-account/consistency/run',
    /** El listado de lo que la verificación encontró. Es un ABM de lectura: sólo se pagina. */
    DISCREPANCY_PAGINATE: '/checking-account/discrepancy/paginate',
    /**
     * A dónde fue la plata de una imputación: `GET /checking-account/allocation/{uuid}/trace`, con
     * el recorrido hacia adelante resuelto por una consulta recursiva.
     */
    TRACE_SUFFIX: '/trace',
  },
  PERMISSIONS: {
    PAGINATE: '/permission/paginate',
  },
  BRANCHES: {
    PAGINATE: '/branch/paginate',
    SAVE: '/branch/save',
    BY_UUID: '/branch/uuid',
    DELETE: '/branch',
    /** Las sucursales activas de la empresa, para elegir en cuál operar: sólo exige pertenecer a ella. */
    AVAILABLE: '/branch/available',
  },
  /**
   * Cajas. A diferencia de los depósitos, el paginado abarca **toda la empresa**
   * (`X-Company-Uuid`) y cada caja informa a qué sucursal pertenece.
   */
  CASH_REGISTERS: {
    PAGINATE: '/cash-register/paginate',
    SAVE: '/cash-register/save',
    BY_UUID: '/cash-register/uuid',
    DELETE: '/cash-register',
    /**
     * A qué caja entrar, resuelto por el backend a partir de la preasignación del usuario en la
     * sucursal activa. El front obedece la respuesta, no decide.
     */
    ENTRY_CONTEXT: '/cash-register/entry-context',
    /**
     * Apertura de la sesión de caja. Es el único endpoint del bloque que lleva el uuid en el medio
     * de la ruta y no como sufijo, así que se arma con una función en vez de concatenar en el
     * service. Responde `409` si la caja ya arrastra una sesión abierta.
     */
    OPEN_SESSION: (uuid: string) => `/cash-register/${uuid}/open`,
  },
  /** Depósitos. El paginado ya viene acotado a la sucursal activa (`X-Branch-Uuid`). */
  WAREHOUSES: {
    PAGINATE: '/warehouse/paginate',
    SAVE: '/warehouse/save',
    BY_UUID: '/warehouse/uuid',
    DELETE: '/warehouse',
  },
  /** Catálogo global de motivos de ajuste (rotura, auditoría, merma, …), igual para toda empresa. */
  ADJUSTMENT_REASONS: {
    PAGINATE: '/adjustment-reason/paginate',
  },
  STOCK: {
    /**
     * Ajuste manual de inventario. Declara **cuánto hay** (`countedQuantity`): el backend lee el
     * saldo real, calcula la diferencia y de su signo deduce el INGRESO o el EGRESO.
     */
    ADJUSTMENT: '/stock/adjustment',
    /**
     * Distribución del producto por depósito, el panel de la pantalla de stock. Con
     * `X-Branch-Uuid` se limita a esa sucursal; omitirlo devuelve toda la empresa y exige
     * `stock.view_all_branches`.
     */
    DISTRIBUTION: (productUuid: string) => `/stock/distribution/${productUuid}`,
    /**
     * Partidas con saldo de un producto, vencimiento primero y con semáforo. Es la grilla de la
     * solapa Stock de un producto `BATCH`; mismo alcance por sucursal que la distribución.
     */
    BATCHES: (productUuid: string) => `/stock/batches/${productUuid}`,
    /** Panel de vencimientos: lotes con fecha, ordenados por vencimiento, con filtros y paginado. */
    EXPIRATIONS: '/stock/expirations',
    /** Las tres tarjetas del panel: vencidos, ≤ 7 días y dentro del umbral de la empresa. */
    EXPIRATIONS_SUMMARY: '/stock/expirations/summary',
    /** Baja masiva de vencidos: un ajuste de egreso con motivo `EXPIRED` por cada lote elegido. */
    EXPIRATIONS_WRITE_OFF: '/stock/expirations/write-off',
    /** La vida de una partida: totales, las operaciones que la tocaron y su kardex. */
    BATCH_TRACEABILITY: (batchUuid: string) => `/stock/batch/${batchUuid}/traceability`,
    /**
     * Unidades de un producto `SERIAL` con sus contadores por estado y el chequeo de consistencia
     * (§9): el saldo de las partidas contra las series `IN_STOCK`. Es la grilla de la solapa Stock;
     * mismo alcance por sucursal que la distribución.
     */
    SERIALS: (productUuid: string) => `/stock/serials/${productUuid}`,
    /**
     * La consulta de postventa: con el número en la mano, a quién se le vendió, cuándo y con qué
     * comprobante. Exige `stock.serial_view` —devuelve el contacto del cliente— y **no acota por
     * sucursal**: la garantía se reclama en cualquier mostrador de la empresa.
     */
    SERIAL_LOOKUP: (serialNumber: string) => `/stock/serial/${encodeURIComponent(serialNumber)}`,
    /** Registrar la devolución de una unidad vendida: pasa a `RETURNED` sin sumar al saldo. */
    SERIAL_RETURN: '/stock/serial/return',
    /**
     * Reingresar al stock una unidad devuelta: vuelve a `IN_STOCK` y **el saldo de su lote sube con
     * ella**, con un movimiento `RETURN` en el kardex. Es la otra mitad de la devolución y la única
     * de las dos que mueve inventario, así que exige además `stock.adjustment`.
     */
    SERIAL_REINSTATE: '/stock/serial/reinstate',
  },
  /**
   * Traslados de stock entre depósitos, propios o de otra sucursal de la empresa. El paginado ya
   * viene acotado a la empresa y —salvo `stock.view_all_branches`— a los traslados en los que la
   * sucursal activa es **origen o destino**: los que hay que recibir importan tanto como los que
   * salieron.
   */
  ASSEMBLIES: {
    PAGINATE: '/assembly/paginate',
    BY_UUID: '/assembly/uuid',
    /**
     * El precálculo: cuánto se puede armar y qué lo limita, el reparto por lote, el costo con su
     * desglose y el vencimiento sugerido. **Lectura pura**, y por eso es un endpoint propio: el
     * costo unitario es el número que más silenciosamente puede salir mal, y la única defensa es
     * verlo antes de grabarlo (RN-24).
     */
    PREVIEW: '/assembly/preview',
    /** Consume los componentes e ingresa el terminado en una sola transacción (RN-23). */
    ASSEMBLE: '/assembly/assemble',
    /** Revierte ESE documento. `409` si las unidades producidas ya salieron. */
    CANCEL: (uuid: string) => `/assembly/${uuid}/cancel`,
    /** Rompe unidades sueltas. NO revierte ningún documento (§6.9). */
    DISASSEMBLE: '/assembly/disassemble',
    /** Del lote de un componente a los clientes: la consulta del recall. */
    TRACE_COMPONENT_BATCH: '/assembly/traceability/component-batch',
    /** El camino inverso: del terminado a los lotes que lo formaron. */
    TRACE_PRODUCED_BATCH: '/assembly/traceability/produced-batch',
  },
  STOCK_TRANSFERS: {
    PAGINATE: '/stock-transfer/paginate',
    /** El detalle. Es la única lectura que trae las líneas —una por lote— y el membrete del remito. */
    BY_UUID: '/stock-transfer/uuid',
    /**
     * Despacho. Descuenta del depósito de origen y, según la modalidad, deja el traslado en viaje
     * (`DEFERRED`) o ya recibido (`IMMEDIATE`). Responde `412` si el stock no alcanza y la política
     * de la sucursal pide confirmación; se reintenta con `forceTransfer: true`.
     */
    DISPATCH: '/stock-transfer/transfer',
    /** Recepción. Sólo la acepta un usuario operando en la sucursal de destino. */
    RECEIVE: (uuid: string) => `/stock-transfer/transfer/${uuid}/receive`,
    /**
     * Cancelación de un traslado en viaje: devuelve la mercadería al depósito de origen recreando
     * cada lote. Espejo de la recepción — sólo la acepta la sucursal de **origen**.
     */
    CANCEL: (uuid: string) => `/stock-transfer/transfer/${uuid}/cancel`,
    /**
     * Lotes con saldo del producto en un depósito, en el orden en que la política de la sucursal
     * los consumiría. Alimenta el reparto manual del despacho.
     */
    SOURCE_BATCHES: '/stock-transfer/source-batches',
    /**
     * Cuántos traslados en viaje espera la sucursal activa y cuántos despachó sin recibir. Es un
     * total de la sucursal, no de la página: es lo que alimenta el aviso del listado.
     */
    SUMMARY: '/stock-transfer/summary',
  },
  /**
   * Compras y ventas comparten tabla y endpoint: lo que las distingue es el comprobante más la
   * contraparte (`customer` = venta, `supplier` = compra). `POST /order/save` responde 410.
   */
  ORDERS: {
    /** Cierre atómico: persiste orden, líneas, pagos y stock, o nada. */
    COMMIT: '/order/commit',
    /**
     * La otra escritura, y la única que toca una orden ya existente: convierte una **orden de
     * compra borrador** —comprobante sin efectos— en la compra terminada. No es un `PUT` de orden;
     * una compra con efectos ya aplicados no se edita por ningún camino.
     */
    CONVERT: (uuid: string) => `/order/${uuid}/convert`,
    PAGINATE: '/order/paginate',
    /** El detalle. Es la única lectura que trae las líneas de la orden. */
    BY_UUID: '/order/uuid',
    DELETE: '/order',
  },
  /**
   * Catálogo de comprobantes por empresa: cada fila lleva el nombre que eligió el usuario y la
   * lógica que dispara (`operationType`, `stockEffect`, `balanceEffect`, `isFiscal`, `addsTax`)
   * juntos. Es catálogo y no emisión: commitear una orden apunta a una de estas filas, no crea
   * comprobantes nuevos.
   */
  VOUCHERS: {
    PAGINATE: '/voucher/paginate',
    SAVE: '/voucher/save',
    BY_UUID: '/voucher/uuid',
    DELETE: '/voucher',
  },
  /** Medios de pago visibles para la empresa: los globales más los personalizados propios. */
  PAYMENT_METHODS: {
    PAGINATE: '/payment-method/paginate',
    BY_UUID: '/payment-method/uuid',
  },
  /**
   * Configuración jerárquica: `DEFAULT < EMPRESA < SUCURSAL < USUARIO` para las claves de negocio,
   * más el nivel `GLOBAL` (instancia) que sólo admiten las de sistema.
   *
   * `DEFINITIONS` es el catálogo —qué claves hay, de qué tipo, con qué default y en qué niveles se
   * pueden pisar— y `EFFECTIVE` los valores que rigen para el contexto del request, cada uno con el
   * nivel del que salió. Reemplazan a `/configuracion/get/{key}`, que devolvía una fila por request
   * y sin decir de qué nivel venía, y obligaba al front a replicar los defaults del backend.
   */
  CONFIGURATION: {
    DEFINITIONS: '/configuration/definitions',
    EFFECTIVE: '/configuration/effective',
    SAVE: '/configuration/save',
    SAVE_LIST: '/configuration/save/list',
  },
  /**
   * Actuator del backend. `info` es público (no pasa por el filtro de auth) y devuelve
   * `version`/`date` de la app más `coreVersion`/`coreDate` del framework Core.
   */
  ACTUATOR: {
    INFO: '/actuator/info',
  },
} as const;

/** Builds an absolute URL for an endpoint path. */
export function apiUrl(endpoint: string): string {
  return `${API_URL}${endpoint}`;
}
