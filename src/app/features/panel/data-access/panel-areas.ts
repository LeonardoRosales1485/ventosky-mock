import { Routes } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { Permission, Permissions } from '../../../core/auth/permissions';
import { FEATURES } from '../../../core/features/feature-flags';

/**
 * Una pantalla interna de un área: no ocupa un lugar en el sidebar, pero sí se puede buscar.
 *
 * Es el caso de "Nuevo producto": vive bajo `/panel/products`, se llega a ella desde el listado y
 * hasta ahora no existía para el buscador porque sólo se indexaba el menú.
 */
export interface PanelPage {
  /**
   * Path relativo al área. Nunca lleva `:param`: una pantalla que exige un id —editar un producto,
   * por ejemplo— no es un destino al que se pueda navegar desde una búsqueda.
   */
  path: string;
  labelKey: string;
  /** Cae al ícono del área cuando no se declara. */
  icon?: string;
  /** Palabras extra que matchea el buscador (independientes del idioma). */
  tags?: readonly string[];
  /** Permiso propio de la pantalla, además del que ya exige el área. */
  permission?: Permission;
}

/**
 * Un área del panel — una ruta lazy, un ítem de sidebar y el permiso que abre las dos.
 *
 * La gracia es que el permiso y la ruta se escriben **una sola vez**: `panel.routes.ts` arma sus
 * guards con esta lista y `NavService` arma el menú y el buscador con la misma, así que el menú no
 * puede ofrecer una puerta que el guard cierra ni esconder una que abriría. Antes eran dos
 * declaraciones distintas del mismo string.
 */
export interface PanelArea {
  /** Path bajo `/panel`, y la clave por la que se rastrea todo lo demás. */
  path: string;
  /**
   * A dónde apunta el ítem del sidebar cuando no es la raíz del área: un área cuya raíz sólo
   * redirige le costaría al menú un salto de navegación. Relativo a `/panel`, igual que
   * {@link path}, con el que debe empezar para que `routerLinkActive` siga marcando toda el área.
   */
  navPath?: string;
  section: PanelSectionId;
  icon: string;
  labelKey: string;
  /** Palabras extra que matchea el buscador (independientes del idioma). */
  tags?: readonly string[];
  /**
   * Permiso necesario para abrir el área. Ausente significa "alcanza con la sesión": la API acota
   * de todos modos los endpoints de la pantalla al usuario firmado.
   *
   * Siempre el más débil que hace que valga la pena abrirla, que es el que el backend valida en el
   * listado de la pantalla.
   */
  permission?: Permission;
  /**
   * Alcanza con **uno** de estos permisos para abrir el área. Es para las áreas que juntan pantallas de
   * varias familias, como el directorio: cada carpeta pide el suyo, y el área se abre con cualquiera.
   * Se suma a {@link permission} si las dos se declaran.
   */
  anyPermission?: readonly Permission[];
  /**
   * El área es la versión acotada de otra: con este permiso el usuario ya tiene la pantalla completa,
   * y ésta no se le ofrece ni se le abre. Es el caso de «Mis compras» frente a «Ventas»: el
   * administrador, que tiene todos los permisos, también tiene `order.view_own`, pero lo suyo es
   * ver todas las ventas, no un listado que el backend acota a su propia ficha.
   */
  supersededBy?: Permission;
  /**
   * El área no dibuja ítem en el sidebar ni aparece en el buscador: se entra a sus pantallas desde
   * otra área. Es el caso de los modelos, cuyas filas viven en el catálogo de productos —el ítem
   * llevaría a un listado que ya no existe—, pero cuyo formulario sigue necesitando su ruta lazy y
   * su guard. Sus {@link pages} se siguen indexando: «Nuevo modelo» es un destino, el área no.
   */
  hidden?: boolean;
  /**
   * `false` apaga el área entera —menú, buscador y ruta— sin importar los permisos: es el
   * interruptor de funcionalidad de `environment.features`. Ausente significa encendida.
   */
  enabled?: boolean;
  /** Pantallas internas del área: no van al sidebar, sí al buscador. */
  pages?: readonly PanelPage[];
  loadChildren: () => Promise<Routes>;
}

export type PanelSectionId =
  'general' | 'operations' | 'checkingAccounts' | 'catalog' | 'contacts' | 'administration';

/**
 * Secciones en el orden en que el sidebar las lista, de lo que se usa todos los días a lo que se
 * configura una vez: primero la operación de mostrador, después el catálogo que la alimenta, los
 * terceros con los que se opera y por último la administración de la empresa.
 *
 * **Cuenta corriente tiene sección propia** y no seis ítems repartidos entre operación y
 * administración. Es un módulo con vocabulario propio —partida, imputación, mora, política— y sus
 * pantallas se usan de a varias en la misma sesión: quien concilia salta del listado a la bandeja
 * de cobros y de ahí a la política. Repartidas, el menú obligaba a recordar en qué mitad quedó
 * cada una.
 */
export const PANEL_SECTIONS: readonly {
  id: PanelSectionId;
  labelKey: string;
  /** No dibuja encabezado en el sidebar; el label sigue valiendo como contexto en el buscador. */
  hidden?: boolean;
}[] = [
  // Un solo ítem —Inicio— no justifica un título arriba de todo, pero sí necesita un nombre para
  // que el buscador pueda ubicarlo debajo de algo.
  { id: 'general', labelKey: 'nav.sections.general', hidden: true },
  { id: 'operations', labelKey: 'nav.sections.operations' },
  { id: 'checkingAccounts', labelKey: 'nav.sections.checkingAccounts' },
  { id: 'catalog', labelKey: 'nav.sections.catalog' },
  { id: 'contacts', labelKey: 'nav.sections.contacts' },
  { id: 'administration', labelKey: 'nav.sections.administration' },
];

export const PANEL_AREAS: readonly PanelArea[] = [
  {
    path: 'home',
    section: 'general',
    icon: 'home',
    labelKey: 'nav.items.home',
    tags: ['home', 'inicio', 'dashboard', 'welcome'],
    loadChildren: () => import('../../home/home.routes').then((m) => m.HOME_ROUTES),
  },
  {
    // El punto de venta exige `order.create`, no `order.view`: el área es la pantalla en la que se
    // registra la venta, y el listado de las realizadas es el área de abajo —`/panel/sales`—, que
    // exige `order.view`.
    path: 'pos',
    section: 'operations',
    icon: 'point_of_sale',
    labelKey: 'nav.items.pos',
    permission: Permissions.orderCreate,
    tags: [
      'pos',
      'point of sale',
      'punto de venta',
      'vender',
      'sell',
      'venta directa',
      'sales',
      'sale',
      'ventas',
      'venta',
      'mostrador',
      'caja',
      'cobrar',
      'checkout',
      'comprobante',
      'factura',
      'ticket',
    ],
    loadChildren: () => import('../../sales/pos.routes').then((m) => m.POS_ROUTES),
  },
  {
    // El listado de las ventas ya registradas: el plural que el punto de venta dejó libre. Exige
    // `order.view` —el permiso con el que el backend deja paginar `/order` del lado de ventas— y no
    // `purchase.view`, que es el de las compras: quien sólo puede ver compras no tiene por qué
    // encontrar esta área en el menú.
    path: 'sales',
    section: 'operations',
    icon: 'receipt',
    labelKey: 'nav.items.sales',
    permission: Permissions.orderView,
    tags: [
      'sales',
      'sale',
      'orders',
      'order',
      'ventas',
      'venta',
      'listado de ventas',
      'historial',
      'history',
      'cliente',
      'clientes',
      'customer',
      'comprobante',
      'factura',
      'ticket',
      'total',
      'facturacion',
    ],
    loadChildren: () => import('../../sales/sales.routes').then((m) => m.SALES_ROUTES),
  },
  {
    // El portal del cliente: el mismo listado de ventas, acotado por el backend a las que tienen de
    // contraparte su propia ficha. Exige `order.view_own` y se esconde a quien tiene `order.view`: para
    // ése el listado completo es «Ventas», y éste sería el mismo listado con otro título.
    path: 'my-purchases',
    section: 'operations',
    icon: 'shopping_bag',
    labelKey: 'nav.items.myPurchases',
    permission: Permissions.orderViewOwn,
    supersededBy: Permissions.orderView,
    tags: [
      'my purchases',
      'mis compras',
      'compras',
      'purchases',
      'portal',
      'comprobante',
      'factura',
    ],
    loadChildren: () =>
      import('../../sales/my-purchases.routes').then((m) => m.MY_PURCHASES_ROUTES),
  },
  {
    // El alta de compra vive en `/panel/new-purchase` y no en `/panel/purchases` por lo mismo que el
    // punto de venta no ocupa `/panel/sales`: el área es la pantalla que **registra** la operación,
    // y «Compras» es el listado de las realizadas, que vive en el área de abajo. Por eso ésta exige
    // `purchase.create` y aquélla `purchase.view`.
    path: 'new-purchase',
    section: 'operations',
    icon: 'add_shopping_cart',
    labelKey: 'nav.items.newPurchase',
    permission: Permissions.purchaseCreate,
    tags: [
      'new purchase',
      'purchase order',
      'purchases',
      'purchase',
      'nueva compra',
      'orden de compra',
      'compras',
      'compra',
      'comprar',
      'registrar compra',
      'proveedor',
      'proveedores',
      'supplier',
      'costo',
      'costos',
      'ingreso de mercaderia',
      'recepcion',
      'remito',
      'factura de compra',
      'comprobante',
      'stock',
    ],
    loadChildren: () =>
      import('../../purchases/new-purchase.routes').then((m) => m.NEW_PURCHASE_ROUTES),
  },
  {
    // El listado de las compras ya registradas: el plural que el alta dejó libre. Exige
    // `purchase.view` —el permiso con el que el backend deja paginar `/order` del lado de compras—
    // y no `order.view`, que es el de las ventas: quien sólo puede ver ventas no tiene por qué
    // encontrar esta área en el menú.
    path: 'purchases',
    section: 'operations',
    icon: 'receipt_long',
    labelKey: 'nav.items.purchases',
    permission: Permissions.purchaseView,
    tags: [
      'purchases',
      'purchase',
      'orders',
      'order',
      'compras',
      'compra',
      'ordenes de compra',
      'listado de compras',
      'historial',
      'history',
      'proveedor',
      'proveedores',
      'supplier',
      'comprobante',
      'factura de compra',
      'remito',
      'total',
      'costos',
    ],
    loadChildren: () => import('../../purchases/purchases.routes').then((m) => m.PURCHASES_ROUTES),
  },
  {
    // El portal del proveedor: el listado de compras, acotado por el backend a las que la empresa le
    // hizo a su propia ficha. Exige `purchase.view_own` y se esconde a quien tiene `purchase.view`.
    path: 'my-sales',
    section: 'operations',
    icon: 'storefront',
    labelKey: 'nav.items.mySales',
    permission: Permissions.purchaseViewOwn,
    supersededBy: Permissions.purchaseView,
    tags: ['my sales', 'mis ventas', 'ventas', 'sales', 'portal', 'proveedor', 'comprobante'],
    loadChildren: () => import('../../purchases/my-sales.routes').then((m) => m.MY_SALES_ROUTES),
  },
  {
    // Traslados de stock. A diferencia de compras y ventas, el alta **no** ocupa su propia área:
    // es una sola entrada de menú, porque consultar y despachar los abre el mismo `transfer.view` de
    // base y lo que separa a las dos pantallas es `transfer.dispatch`, que el botón «Nuevo
    // traslado» valida por su cuenta. Por eso el despacho entra acá como pantalla interna: no va al
    // sidebar, sí al buscador. Es `transfer.view` y no `stock.view`: con `stock.view` el vendedor
    // —que lo tenía para el mostrador— veía el área entera de traslados.
    path: 'stock-transfers',
    section: 'operations',
    icon: 'swap_horiz',
    labelKey: 'nav.items.stockTransfers',
    permission: Permissions.transferView,
    tags: [
      'stock transfers',
      'transfer',
      'transfers',
      'traslados',
      'traslado',
      'transferencias',
      'transferencia',
      'mover stock',
      'deposito',
      'depositos',
      'warehouse',
      'sucursal',
      'sucursales',
      'en viaje',
      'recibir',
      'recepcion',
      'remito',
      'lote',
      'lotes',
      'stock',
      'inventario',
    ],
    pages: [
      {
        path: 'new',
        labelKey: 'stockTransfers.form.title',
        icon: 'add',
        permission: Permissions.transferDispatch,
        tags: [
          'nuevo',
          'new',
          'alta',
          'crear',
          'create',
          'despachar',
          'dispatch',
          'traslado',
          'transfer',
          'mover',
          'enviar',
        ],
      },
    ],
    loadChildren: () =>
      import('../../stock-transfers/stock-transfers.routes').then((m) => m.STOCK_TRANSFERS_ROUTES),
  },
  {
    // Armados de kits (Entrega G). Igual que los traslados, el alta **no** ocupa su propia área: es
    // una sola entrada de menú, porque consultar y armar los abre el mismo `assembly.view` de base y
    // lo que separa a las pantallas es `assembly.create`. El desarme y la trazabilidad entran como
    // pantallas internas: no van al sidebar, sí al buscador.
    path: 'assemblies',
    section: 'operations',
    icon: 'precision_manufacturing',
    labelKey: 'nav.items.assemblies',
    permission: Permissions.assemblyView,
    tags: [
      'armados',
      'armado',
      'armar',
      'kit armado',
      'ensamblar',
      'ensamblado',
      'produccion',
      'elaborado',
      'elaborados',
      'rotiseria',
      'fiambreria',
      'bandeja',
      'canasta',
      'assembly',
      'assemblies',
    ],
    pages: [
      {
        path: 'new',
        labelKey: 'assemblies.form.title',
        icon: 'add',
        permission: Permissions.assemblyCreate,
        tags: ['nuevo armado', 'armar', 'producir', 'registrar armado'],
      },
      {
        path: 'disassemble',
        labelKey: 'assemblies.disassemble.title',
        icon: 'call_split',
        permission: Permissions.assemblyDisassemble,
        tags: ['desarmar', 'desarme', 'romper', 'devolver componentes'],
      },
      {
        path: 'traceability',
        labelKey: 'assemblies.traceability.title',
        icon: 'account_tree',
        tags: ['trazabilidad', 'recall', 'retiro', 'lote', 'a quien se le vendio'],
      },
    ],
    loadChildren: () =>
      import('../../assemblies/assemblies.routes').then((m) => m.ASSEMBLIES_ROUTES),
  },
  {
    // Lotes y vencimientos: el panel que un rubro perecedero mira todos los días, y la trazabilidad
    // de cada partida. La raíz redirige al panel, así que el ítem del sidebar apunta directo a él.
    // `batch/:uuid` exige un lote y no es un destino del buscador.
    path: 'stock',
    navPath: 'stock/expirations',
    section: 'operations',
    icon: 'event_busy',
    labelKey: 'nav.items.stock',
    permission: Permissions.stockExpirationView,
    tags: [
      'vencimientos',
      'vencimiento',
      'vencidos',
      'expirations',
      'expired',
      'lotes',
      'lote',
      'partidas',
      'partida',
      'batch',
      'batches',
      'fefo',
      'trazabilidad',
      'traceability',
      'recall',
      'stock',
      'inventario',
    ],
    pages: [
      {
        // La consulta de postventa. Es pantalla interna y no ítem del sidebar porque no se llega
        // navegando: se llega con la etiqueta en la mano, y los dos caminos reales son el buscador
        // global y el link de cada serie en la ficha del producto.
        //
        // `stock.serial_view` es propio —la respuesta trae el contacto del cliente— y se suma al
        // `stock.expiration_view` que ya exige el área.
        path: 'serial',
        labelKey: 'stock.serial.navLabel',
        icon: 'qr_code_scanner',
        permission: Permissions.stockSerialView,
        tags: [
          'serie',
          'series',
          'numero de serie',
          'serial',
          'serials',
          'imei',
          'garantia',
          'garantía',
          'postventa',
          'posventa',
          'warranty',
          'a quien le vendi',
          'notebook',
          'electro',
          'informatica',
          'unidad',
          'unidades',
        ],
      },
    ],
    loadChildren: () => import('../../stock/stock.routes').then((m) => m.STOCK_ROUTES),
  },

  {
    // Cuentas corrientes. El módulo entero cuelga de una sección propia, y adentro repite el
    // reparto de ventas y compras: el plural consulta y la ruta que nombra la acción registra.
    //
    // El permiso es el más débil que hace que valga la pena abrir la pantalla, que es el que el
    // backend valida en su listado. `collect` y `config` se exigen en las áreas que escriben.
    path: 'checking-accounts',
    permission: Permissions.checkingAccountView,
    section: 'checkingAccounts',
    icon: 'account_balance_wallet',
    labelKey: 'nav.items.checkingAccounts',
    tags: [
      'checking accounts',
      'checking account',
      'cuentas corrientes',
      'cuenta corriente',
      'saldo',
      'saldos',
      'deuda',
      'deudas',
      'partidas abiertas',
      'vencimiento',
      'vencimientos',
      'vencido',
      'morosidad',
      'moroso',
      'mora',
      'fiado',
      'limite de credito',
      'estado de cuenta',
      'extracto',
      'imputacion',
      'imputar',
      'compensar',
    ],
    loadChildren: () =>
      import('../../checking-accounts/checking-accounts.routes').then(
        (m) => m.CHECKING_ACCOUNTS_ROUTES,
      ),
  },
  {
    path: 'new-collection',
    section: 'checkingAccounts',
    icon: 'payments',
    labelKey: 'nav.items.newCollection',
    tags: [
      'new collection',
      'collection',
      'payment',
      'registrar cobro',
      'nuevo cobro',
      'cobrar',
      'cobro',
      'cobranza',
      'pagar',
      'pago',
      'recibo',
      'cuenta corriente',
      'imputar',
      'imputacion',
      'fifo',
    ],
    permission: Permissions.checkingAccountCollect,
    loadChildren: () =>
      import('../../checking-accounts/new-collection.routes').then((m) => m.NEW_COLLECTION_ROUTES),
  },
  {
    path: 'collections',
    section: 'checkingAccounts',
    icon: 'request_quote',
    labelKey: 'nav.items.collections',
    tags: [
      'collections',
      'collection',
      'cobros',
      'cobro',
      'pagos',
      'pago',
      'recibos',
      'recibo',
      'cuenta corriente',
      'imputacion',
      'sin imputar',
      'bandeja',
      'anular',
    ],
    permission: Permissions.checkingAccountView,
    loadChildren: () =>
      import('../../checking-accounts/collections.routes').then((m) => m.COLLECTIONS_ROUTES),
  },
  {
    // La política de la empresa va debajo de las tres pantallas de operación y no en otra sección:
    // se configura una vez y rige para todos los titulares, pero el vocabulario es el mismo y quien
    // la busca viene de mirar una cuenta.
    path: 'settings/checking-accounts',
    section: 'checkingAccounts',
    icon: 'tune',
    labelKey: 'nav.items.checkingAccountPolicy',
    tags: [
      'checking account policy',
      'policy',
      'credit limit',
      'politica de cuenta corriente',
      'politica',
      'limite de deuda',
      'limite de credito',
      'plazo de vencimiento',
      'vencimiento',
      'imputacion automatica',
      'fifo',
      'configuracion',
    ],
    permission: Permissions.checkingAccountConfig,
    loadChildren: () =>
      import('../../checking-accounts/checking-account-policy.routes').then(
        (m) => m.CHECKING_ACCOUNT_POLICY_ROUTES,
      ),
  },
  {
    /**
     * La carga de saldos iniciales se hace **una vez en la vida de la empresa**, define de dónde
     * arranca el módulo entero y pide el mismo permiso que la política, así que va al lado y no
     * entre las pantallas del día a día: ponerla arriba invitaría a usarla como si lo fuera.
     */
    path: 'settings/opening-balance',
    section: 'checkingAccounts',
    icon: 'upload_file',
    labelKey: 'nav.items.openingBalance',
    tags: [
      'opening balance',
      'saldos iniciales',
      'saldo inicial',
      'apertura',
      'migracion',
      'importar deuda',
      'importador',
      'carga inicial',
      'cuenta corriente',
      'csv',
    ],
    permission: Permissions.checkingAccountConfig,
    loadChildren: () =>
      import('../../checking-account-opening/opening-balance.routes').then(
        (m) => m.OPENING_BALANCE_ROUTES,
      ),
  },
  {
    /**
     * Las diferencias entre el cache y las partidas. Cierra la sección porque es la pantalla que se
     * mira cuando algo no cuadra, no la que se abre para trabajar — y exige `config` como las dos
     * de arriba: recalcular una cuenta reescribe un cache.
     */
    path: 'settings/checking-account-consistency',
    section: 'checkingAccounts',
    icon: 'rule',
    labelKey: 'nav.items.checkingAccountConsistency',
    tags: [
      'consistency',
      'discrepancy',
      'consistencia',
      'diferencias',
      'descuadre',
      'recalcular',
      'verificar',
      'cache',
      'saldo',
      'morosidad',
      'cuenta corriente',
      'auditoria',
    ],
    permission: Permissions.checkingAccountConfig,
    loadChildren: () =>
      import('../../checking-accounts/consistency.routes').then((m) => m.CONSISTENCY_ROUTES),
  },
  {
    // El catálogo de solo lectura: lo que ve del producto quien no administra el catálogo —el cliente
    // del portal, el vendedor, el transportista—. Se abre con `product.view`, que es lo que exige
    // `/product/paginate` acotado a la sucursal activa, y se esconde a quien tiene
    // `product.branch_assign`: ése tiene la pantalla de productos entera, que es la de abajo.
    path: 'catalog',
    section: 'catalog',
    icon: 'storefront',
    labelKey: 'nav.items.catalog',
    permission: Permissions.productView,
    supersededBy: Permissions.productBranchAssign,
    tags: [
      'catalog',
      'catalogo',
      'products',
      'productos',
      'producto',
      'articulos',
      'marca',
      'categoria',
      'sku',
      'stock',
    ],
    loadChildren: () => import('../../catalog/catalog.routes').then((m) => m.CATALOG_ROUTES),
  },
  {
    // El listado usa `/product/paginate-all`, que exige `product.branch_assign` y no `product.view`:
    // con `product.view` el ítem llevaría a una pantalla que responde 403.
    path: 'products',
    section: 'catalog',
    icon: 'inventory_2',
    labelKey: 'nav.items.products',
    permission: Permissions.productBranchAssign,
    tags: [
      'products',
      'product',
      'productos',
      'producto',
      'abm',
      'crud',
      'catalog',
      'catalogo',
      'precios',
      'prices',
      'stock',
      'sku',
    ],
    pages: [
      {
        path: 'new',
        labelKey: 'products.form.createTitle',
        icon: 'add',
        permission: Permissions.productCreate,
        tags: [
          'nuevo',
          'new',
          'alta',
          'crear',
          'create',
          'agregar',
          'add',
          'producto',
          'product',
          'articulo',
          'item',
        ],
      },
    ],
    loadChildren: () => import('../../products/products.routes').then((m) => m.PRODUCTS_ROUTES),
  },
  {
    path: 'categories',
    section: 'catalog',
    icon: 'account_tree',
    labelKey: 'nav.items.categories',
    permission: Permissions.categoryView,
    tags: [
      'categories',
      'category',
      'categorias',
      'categoria',
      'tree',
      'arbol',
      'abm',
      'crud',
      'catalog',
      'catalogo',
      'productos',
      'products',
    ],
    loadChildren: () =>
      import('../../categories/categories.routes').then((m) => m.CATEGORIES_ROUTES),
  },
  {
    path: 'brands',
    section: 'catalog',
    icon: 'sell',
    labelKey: 'nav.items.brands',
    permission: Permissions.brandView,
    tags: [
      'brands',
      'brand',
      'marcas',
      'marca',
      'abm',
      'crud',
      'catalog',
      'catalogo',
      'productos',
      'products',
    ],
    loadChildren: () => import('../../brands/brands.routes').then((m) => m.BRANDS_ROUTES),
  },
  {
    // Los modelos agrupan productos hermanos que se diferencian por talle, color o capacidad. El
    // modelo no se vende ni tiene stock: lo tienen sus variantes, que son productos normales
    // (RN-11), y desde que el catálogo de productos los lista agrupados (§5.6, wireframe `1a`) no
    // hay un listado de modelos que poner en el menú: el área sobrevive por su formulario —la
    // matriz—, al que se llega desde el listado de productos.
    path: 'product-models',
    section: 'catalog',
    icon: 'style',
    labelKey: 'nav.items.productModels',
    permission: Permissions.productModelView,
    hidden: true,
    enabled: FEATURES.productModels,
    pages: [
      {
        path: 'new',
        labelKey: 'productModels.form.createTitle',
        icon: 'add',
        permission: Permissions.productModelCreate,
        // Los tags del área desaparecieron con su ítem: los que valían para encontrar los modelos
        // —talle, color, ropa— se mudan acá, que es lo único que quedó para ofrecer.
        tags: [
          'nuevo',
          'new',
          'alta',
          'crear',
          'create',
          'modelo',
          'modelos',
          'model',
          'models',
          'variantes',
          'variants',
          'matriz',
          'talle',
          'talles',
          'color',
          'colores',
          'ropa',
          'calzado',
        ],
      },
    ],
    loadChildren: () =>
      import('../../product-models/product-models.routes').then((m) => m.PRODUCT_MODELS_ROUTES),
  },
  {
    // Catálogo de empresa, igual que las marcas: los ejes se escriben una vez y se reusan en todos
    // los modelos. No es `category_attributes` (RN-13), que describe en vez de generar productos.
    path: 'product-options',
    section: 'catalog',
    icon: 'tune',
    labelKey: 'nav.items.productOptions',
    permission: Permissions.productOptionView,
    tags: [
      'opciones',
      'options',
      'ejes',
      'variantes',
      'variants',
      'talle',
      'talles',
      'color',
      'colores',
      'capacidad',
      'medida',
      'abm',
      'crud',
      'catalogo',
      'catalog',
    ],
    loadChildren: () =>
      import('../../product-options/product-options.routes').then((m) => m.PRODUCT_OPTIONS_ROUTES),
  },
  {
    path: 'price-lists',
    section: 'catalog',
    icon: 'price_change',
    labelKey: 'nav.items.priceLists',
    permission: Permissions.priceListView,
    tags: [
      'price lists',
      'price list',
      'listas de precios',
      'lista de precios',
      'precios',
      'prices',
      'abm',
      'crud',
      'principal',
      'costo',
      'cost',
    ],
    loadChildren: () =>
      import('../../price-lists/price-lists.routes').then((m) => m.PRICE_LISTS_ROUTES),
  },
  {
    path: 'price-rules',
    section: 'catalog',
    icon: 'percent',
    labelKey: 'nav.items.priceRules',
    permission: Permissions.priceRuleView,
    tags: [
      'price rules',
      'price rule',
      'reglas de precio',
      'regla de precio',
      'markup',
      'margen',
      'margin',
      'recargo',
      'porcentaje',
      'percent',
      'abm',
      'crud',
      'precios',
      'prices',
    ],
    pages: [
      {
        path: 'new',
        labelKey: 'priceRules.form.createTitle',
        icon: 'add',
        permission: Permissions.priceRuleCreate,
        tags: [
          'nueva',
          'new',
          'alta',
          'crear',
          'create',
          'agregar',
          'add',
          'regla',
          'rule',
          'markup',
          'margen',
        ],
      },
    ],
    loadChildren: () =>
      import('../../price-rules/price-rules.routes').then((m) => m.PRICE_RULES_ROUTES),
  },
  {
    // Las promociones viven en el catálogo, al lado de las listas y las reglas de precio: son la
    // tercera cosa que decide lo que sale en la caja, y se configuran en la misma sesión.
    path: 'promotions',
    section: 'catalog',
    icon: 'local_offer',
    labelKey: 'nav.items.promotions',
    permission: Permissions.promotionView,
    tags: [
      'promotions',
      'promotion',
      'promociones',
      'promocion',
      // El glosario reserva «descuento» para el importe que resta en una venta, pero el buscador no
      // es el glosario: quien busca «descuentos» viene a configurar una promoción.
      'descuentos',
      'descuento',
      'discounts',
      'discount',
      'ofertas',
      'oferta',
      '3x2',
      '2x1',
      'nxm',
      'abm',
      'crud',
      'catalogo',
      'catalog',
    ],
    pages: [
      {
        path: 'new',
        labelKey: 'promotions.form.createTitle',
        icon: 'add',
        permission: Permissions.promotionCreate,
        tags: [
          'nueva',
          'new',
          'alta',
          'crear',
          'create',
          'agregar',
          'add',
          'promocion',
          'promotion',
          'descuento',
          'discount',
          '3x2',
        ],
      },
    ],
    loadChildren: () =>
      import('../../promotions/promotions.routes').then((m) => m.PROMOTIONS_ROUTES),
  },
  {
    // El directorio junta en un árbol de carpetas a los clientes, los proveedores, los empleados por tipo y
    // quienes entran al sistema: la carpeta donde se está parado decide las columnas y qué pregunta el alta.
    // Se abre con cualquiera de sus permisos de lectura, y cada carpeta pide el suyo —quien sólo ve clientes,
    // ve sólo esa carpeta—.
    path: 'directory',
    section: 'contacts',
    icon: 'contacts',
    labelKey: 'nav.items.directory',
    anyPermission: [
      Permissions.customerView,
      Permissions.supplierView,
      Permissions.employeeView,
      Permissions.userView,
    ],
    tags: [
      'directory',
      'directorio',
      'personas',
      'people',
      'terceros',
      'clientes',
      'customers',
      'proveedores',
      'suppliers',
      'cuit',
      'empleados',
      'employees',
      'transportistas',
      'choferes',
      'vendedores',
      'compradores',
      'legajo',
      'acceso',
      'usuarios',
      'login',
    ],
    loadChildren: () => import('../../directory/directory.routes').then((m) => m.DIRECTORY_ROUTES),
  },
  {
    // El catálogo de campos extra de empleado va con los terceros y no en administración: lo que
    // define es qué se le pregunta a una persona, y la ficha que lo completa es la del empleado.
    // Exige su propio `employee_attribute.view`, no `employee.view`: quien carga empleados no
    // necesariamente decide qué campos existen.
    path: 'employee-attributes',
    section: 'contacts',
    icon: 'badge',
    labelKey: 'nav.items.employeeAttributes',
    permission: Permissions.employeeAttributeView,
    tags: [
      'employee fields',
      'employee attributes',
      'campos de empleados',
      'campos extra',
      'datos extra',
      'empleados',
      'empleado',
      'legajo',
      'talle',
      'uniforme',
      'obra social',
    ],
    loadChildren: () =>
      import('../../employee-attributes/employee-attributes.routes').then(
        (m) => m.EMPLOYEE_ATTRIBUTES_ROUTES,
      ),
  },
  {
    /**
     * La fusión de duplicados vive al lado del directorio y no adentro de una carpeta: un duplicado
     * puede ser un cliente y un proveedor a la vez, y la operación da de baja una ficha entera.
     *
     * El permiso del menú es el de baja de clientes; el endpoint exige además el de proveedores,
     * porque una fusión puede absorber los dos roles de una sola vez.
     */
    path: 'party-merge',
    section: 'contacts',
    icon: 'merge',
    labelKey: 'nav.items.partyMerge',
    permission: Permissions.customerDelete,
    tags: [
      'merge',
      'fusion',
      'fusionar',
      'duplicados',
      'duplicate',
      'terceros',
      'clientes',
      'proveedores',
      'cuit',
    ],
    loadChildren: () =>
      import('../../party-merge/party-merge.routes').then((m) => m.PARTY_MERGE_ROUTES),
  },
  {
    path: 'branches',
    section: 'administration',
    icon: 'store',
    labelKey: 'nav.items.branches',
    permission: Permissions.branchView,
    tags: ['branches', 'branch', 'sucursales', 'sucursal', 'abm', 'crud', 'tienda', 'store'],
    loadChildren: () => import('../../branches/branches.routes').then((m) => m.BRANCHES_ROUTES),
  },
  {
    // El listado y el alta trabajan siempre sobre la sucursal activa: el backend acota
    // `/warehouse/paginate` al header `X-Branch-Uuid`.
    path: 'warehouses',
    section: 'administration',
    icon: 'warehouse',
    labelKey: 'nav.items.warehouses',
    permission: Permissions.warehouseView,
    tags: [
      'warehouses',
      'warehouse',
      'depositos',
      'deposito',
      'almacenes',
      'almacen',
      'abm',
      'crud',
      'stock',
      'inventario',
      'inventory',
    ],
    loadChildren: () =>
      import('../../warehouses/warehouses.routes').then((m) => m.WAREHOUSES_ROUTES),
  },
  {
    // A diferencia de los depósitos, el listado abarca toda la empresa: `/cash-register/paginate`
    // no se acota a `X-Branch-Uuid`, así que cada caja muestra su sucursal.
    path: 'cash-registers',
    section: 'administration',
    icon: 'local_atm',
    labelKey: 'nav.items.cashRegisters',
    permission: Permissions.cashRegisterView,
    tags: [
      'cash registers',
      'cash register',
      'cajas',
      'caja',
      'abm',
      'crud',
      'pos',
      'punto de venta',
      'arqueo',
      'cajero',
      'preasignada',
      'preferencial',
    ],
    loadChildren: () =>
      import('../../cash-registers/cash-registers.routes').then((m) => m.CASH_REGISTERS_ROUTES),
  },
  {
    // `/user/paginate` exige `user.view` y lista sólo los usuarios de la empresa activa, cada uno con
    // su vínculo con esa empresa y no con las demás.
    path: 'users',
    section: 'administration',
    icon: 'people',
    labelKey: 'nav.items.users',
    permission: Permissions.userView,
    tags: ['users', 'usuarios', 'abm', 'crud', 'accounts', 'cuentas', 'people', 'personas'],
    loadChildren: () => import('../../users/users.routes').then((m) => m.USERS_ROUTES),
  },
  {
    // Se dibuja entera desde `GET /configuration/definitions`: una clave nueva del backend aparece
    // acá sin tocar el front, con dos claves de i18n. Exige `configuration.view` para entrar; sin
    // `configuration.edit` la pantalla queda de lectura.
    path: 'configuration',
    section: 'administration',
    icon: 'tune',
    labelKey: 'nav.items.configuration',
    permission: Permissions.configurationView,
    tags: [
      'configuration',
      'settings',
      'configuracion',
      'ajustes',
      'parametros',
      'parameters',
      'politicas',
      'policies',
      'costeo',
      'stock',
      'balanza',
    ],
    loadChildren: () =>
      import('../../configuration/configuration.routes').then((m) => m.CONFIGURATION_ROUTES),
  },
  {
    // `/role/paginate` exige `role.view` y lista los roles de la empresa activa más los globales.
    path: 'roles',
    section: 'administration',
    icon: 'admin_panel_settings',
    labelKey: 'nav.items.roles',
    permission: Permissions.roleView,
    tags: ['roles', 'role', 'permisos', 'permissions', 'abm', 'crud', 'rbac', 'access', 'acceso'],
    loadChildren: () => import('../../roles/roles.routes').then((m) => m.ROLES_ROUTES),
  },
];

/** Ruta absoluta a la que apunta el ítem del sidebar. */
export function panelAreaRoute(area: PanelArea): string {
  return `/panel/${area.navPath ?? area.path}`;
}

/** Ruta absoluta de una pantalla interna del área. */
export function panelPageRoute(area: PanelArea, page: PanelPage): string {
  return `/panel/${area.path}/${page.path}`;
}

/**
 * El único predicado detrás del guard de la ruta y del menú: mientras los dos pregunten lo mismo,
 * el sidebar no puede listar un área a la que el guard no deja entrar.
 */
export function canAccessArea(area: PanelArea, auth: AuthService): boolean {
  if (area.enabled === false) {
    return false;
  }
  if (area.permission && !auth.hasPermission(area.permission)) {
    return false;
  }
  if (area.supersededBy && auth.hasPermission(area.supersededBy)) {
    return false;
  }

  return (
    !area.anyPermission || area.anyPermission.some((permission) => auth.hasPermission(permission))
  );
}

/** Una pantalla interna hereda el permiso del área y puede pedir uno propio encima. */
export function canAccessPage(area: PanelArea, page: PanelPage, auth: AuthService): boolean {
  if (!canAccessArea(area, auth)) {
    return false;
  }

  return !page.permission || auth.hasPermission(page.permission);
}
