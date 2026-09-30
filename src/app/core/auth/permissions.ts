/**
 * Los permisos que el front nombra, escritos una sola vez.
 *
 * Son los mismos strings del `PermissionEnum` del backend: quien los valida de verdad es la API, así
 * que acá sólo se usan para no ofrecer una puerta que el servidor va a cerrar con un 403 —el ítem de
 * menú, el botón de alta, la entrada del buscador.
 */
export const Permissions = {
  brandView: 'brand.view',
  brandCreate: 'brand.create',
  brandEdit: 'brand.edit',
  brandDelete: 'brand.delete',

  branchView: 'branch.view',
  branchCreate: 'branch.create',
  branchEdit: 'branch.edit',
  branchDelete: 'branch.delete',

  /**
   * Cajas. El ABM gobierna también la preasignación de usuarios ("caja preferencial"): no hay un
   * permiso propio para asignar, se hace con `cash_register.create` / `cash_register.edit`.
   */
  cashRegisterView: 'cash_register.view',
  cashRegisterCreate: 'cash_register.create',
  cashRegisterEdit: 'cash_register.edit',
  cashRegisterDelete: 'cash_register.delete',
  /** Abrir la sesión de caja. Sin sesión que cubra su fecha, ninguna compra ni venta se commitea. */
  cashRegisterOpen: 'cash_register.open',

  /**
   * Cuentas corrientes. Es la familia más granular del enum porque cada verbo tiene un riesgo
   * distinto: consultar un saldo no es cobrarlo, imputar no es anular, y forzar una venta a un
   * cliente moroso es una decisión que una empresa quiere poder dar a una sola persona.
   *
   * Todavía **no** los declara el `PermissionEnum` del backend: el módulo corre contra un mock. Ver
   * el comentario del área en `panel-areas.ts` — mientras eso siga así, las pantallas no los exigen,
   * porque un permiso que ningún rol tiene esconde el área de todos.
   */
  checkingAccountView: 'checking_account.view',
  checkingAccountCollect: 'checking_account.collect',
  checkingAccountAllocate: 'checking_account.allocate',
  checkingAccountAdjust: 'checking_account.adjust',
  checkingAccountVoid: 'checking_account.void',
  checkingAccountDelinquency: 'checking_account.delinquency',
  checkingAccountConfig: 'checking_account.config',
  checkingAccountOverrideLimit: 'checking_account.override_limit',

  /**
   * Configuración jerárquica. Son dos y no cuatro: crear un override y editarlo son la misma
   * acción —un upsert por clave natural—, y borrarlo es guardar `value: null`. `configuration.view`
   * abre además las claves privadas y la inspección de otra sucursal del inquilino.
   */
  configurationView: 'configuration.view',
  configurationEdit: 'configuration.edit',

  categoryView: 'category.view',
  categoryCreate: 'category.create',
  categoryEdit: 'category.edit',
  categoryDelete: 'category.delete',

  customerView: 'customer.view',
  customerCreate: 'customer.create',
  customerEdit: 'customer.edit',
  customerDelete: 'customer.delete',

  /**
   * Ventas. `POST /order/commit` exige `order.create` cuando la contraparte es un cliente y
   * `purchase.create` cuando es un proveedor: es el mismo endpoint, y el permiso es lo único que
   * distingue una compra de una venta a efectos de RBAC.
   */
  orderView: 'order.view',
  orderCreate: 'order.create',
  orderDelete: 'order.delete',
  /**
   * Sólo las ventas cuya contraparte es la propia ficha de cliente: el portal del cliente. El backend
   * acota `/order/*` a lo suyo cuando el usuario no tiene `order.view` ni `purchase.view`; quien tiene
   * `order.view` ve todas y no necesita éste, y por eso «Mis compras» se le esconde.
   */
  orderViewOwn: 'order.view_own',

  /**
   * Compras. Es la otra mitad de la familia de arriba: el endpoint es el mismo (`/order/*`) y el
   * backend elige entre una y otra por la contraparte que viaja —proveedor exige `purchase.*`,
   * cliente exige `order.*`—. Por eso son dos familias separadas y no un permiso con dos usos: una
   * empresa puede querer que quien carga compras no pueda facturar ventas, y al revés.
   */
  purchaseView: 'purchase.view',
  purchaseCreate: 'purchase.create',
  /**
   * Editar una compra, que en el backend es una sola cosa: `POST /order/{uuid}/convert`, la
   * conversión de una orden de compra borrador en la compra terminada. No hay `PUT` de orden —
   * `/order/save` responde 410—, así que una compra con efectos ya aplicados no se edita con ningún
   * permiso.
   */
  purchaseEdit: 'purchase.edit',
  purchaseDelete: 'purchase.delete',
  /** Lo mismo del lado del proveedor: sólo las compras que la empresa le hizo a su ficha. */
  purchaseViewOwn: 'purchase.view_own',

  /**
   * Catálogo de comprobantes: es lo que declara qué hace la venta con stock y balance. El backend
   * fusionó `voucher_type` dentro de `voucher`, así que la familia entera es `voucher.*` y ya no
   * existe `voucher_type.view`.
   */
  voucherView: 'voucher.view',
  voucherCreate: 'voucher.create',
  voucherEdit: 'voucher.edit',
  voucherDelete: 'voucher.delete',

  /** Medios de pago: la venta sólo los lista, el ABM vive en otra pantalla. */
  paymentView: 'payment.view',

  /**
   * Listas de precios. El backend las nombra `pricelist.*` (sin separador), a diferencia de
   * `price_rule.*`: son dos familias distintas del mismo `PermissionEnum`.
   */
  priceListView: 'pricelist.view',
  priceListCreate: 'pricelist.create',
  priceListEdit: 'pricelist.edit',
  priceListDelete: 'pricelist.delete',

  priceRuleView: 'price_rule.view',
  priceRuleCreate: 'price_rule.create',
  priceRuleEdit: 'price_rule.edit',
  priceRuleDelete: 'price_rule.delete',

  /**
   * Promociones. `promotion.edit` cubre también **discontinuar y reactivar**: no son endpoints
   * propios sino una edición con `isDiscontinued`, y archivar es el `delete` — de ahí que la familia
   * sean cuatro y no seis.
   *
   * **No existe `promotion.exclude`**: quitar una promoción de una venta puntual quedó fuera de v1.
   * El vendedor no necesita ninguno de estos para que las promociones se apliquen: el motor corre
   * solo en el commit.
   */
  promotionView: 'promotion.view',
  promotionCreate: 'promotion.create',
  promotionEdit: 'promotion.edit',
  promotionDelete: 'promotion.delete',

  /**
   * Historial de precios. Es de solo lectura —el backend lo escribe él mismo y responde `400` a
   * `/save` y `/delete`—, así que la familia tiene un único permiso y lo exigen todas sus vías.
   */
  priceHistoryView: 'price_history.view',

  productView: 'product.view',
  productCreate: 'product.create',
  productEdit: 'product.edit',
  productDelete: 'product.delete',
  /**
   * Administrar el catálogo completo: ver todos los productos de la empresa (`/product/paginate-all`)
   * y asignarles sucursales. Es lo que exige la pantalla de productos, no `product.view`.
   */
  productBranchAssign: 'product.branch_assign',
  /**
   * Editar la composición de un kit. Se suma a `product.edit`: cambiar qué trae el combo cambia lo
   * que descuenta cada venta (RN-08), y el backend responde `403` si el `/save` trae `kitItems`
   * sin este permiso.
   */
  productKitEdit: 'product.kit_edit',

  /**
   * ABM de modelos y de la matriz de variantes. Los permisos de producto **no cambian**: una
   * variante es un producto y se gobierna con `product.*` como cualquier otro. Éstos habilitan el
   * agrupador y la generación de la matriz, que es donde se crean N productos de una sola pasada.
   */
  productModelView: 'productmodel.view',
  productModelCreate: 'productmodel.create',
  productModelEdit: 'productmodel.edit',
  productModelDelete: 'productmodel.delete',
  /**
   * ABM del catálogo de ejes y valores de variante. Es catálogo de empresa, como la marca, y por eso
   * tiene permiso propio: quien carga productos no necesariamente decide qué ejes existen.
   */
  productOptionView: 'productoption.view',
  productOptionCreate: 'productoption.create',
  productOptionEdit: 'productoption.edit',
  productOptionDelete: 'productoption.delete',

  /** Ver depósitos: lo exige `/warehouse/paginate`, que alimenta el select del ajuste de stock. */
  warehouseView: 'warehouse.view',
  warehouseCreate: 'warehouse.create',
  warehouseEdit: 'warehouse.edit',
  warehouseDelete: 'warehouse.delete',

  /** Consultar stock y sus catálogos; es lo que pide `/adjustment-reason/paginate`. */
  stockView: 'stock.view',
  /** Ajuste manual de inventario (`POST /stock/adjustment`). */
  stockAdjustment: 'stock.adjustment',
  /**
   * Leer stock de **toda la empresa**, no sólo de la sucursal activa. Es lo que habilita omitir
   * `X-Branch-Uuid` en `GET /stock/distribution/{uuid}` y `POST /warehouse/paginate`: la única
   * lectura que cruza el aislamiento por sucursal. Ver `core/http/branch-scope.ts`.
   */
  stockViewAllBranches: 'stock.view_all_branches',
  /**
   * Elegir a mano de qué lote sale una línea de venta, saliéndose de la política de asignación de
   * la sucursal (FEFO / FIFO / prioridad). Sin él el lote asignado se ve pero no se cambia.
   */
  stockBatchSelect: 'stock.batch_select',
  /**
   * Panel de vencimientos (`GET /stock/expirations`) y la baja masiva de vencidos, que genera un
   * ajuste de egreso con motivo `EXPIRED`.
   */
  stockExpirationView: 'stock.expiration_view',
  /**
   * Consulta por número de serie (`GET /stock/serial/{n}`) y el registro de devolución de una
   * unidad vendida.
   *
   * Es propio y no `stock.view` porque la respuesta trae el **contacto del cliente** al que se le
   * vendió la unidad: quien mira el depósito no necesariamente puede ver a quién se le facturó. La
   * grilla de series de la ficha sí va con `stock.view` — ahí no hay ningún dato del cliente.
   */
  stockSerialView: 'stock.serial_view',

  // Armados de kits (Entrega G). NO hay `assembly.edit`: un armado no se edita, se cancela y se
  // rehace, igual que una compra.
  assemblyView: 'assembly.view',
  assemblyCreate: 'assembly.create',
  assemblyCancel: 'assembly.cancel',
  // Desarmar es propio y no `assembly.cancel`: cancelar revierte UN documento y sólo si nadie tocó
  // las unidades; desarmar rompe unidades sueltas que pueden venir de armados distintos.
  assemblyDisassemble: 'assembly.disassemble',
  /**
   * Ver los traslados de stock: el listado, el detalle y el resumen de la sucursal. Es propio y no
   * `stock.view`: quien ve el stock de su sucursal no necesariamente sigue lo que viaja entre
   * sucursales, y con `stock.view` el vendedor veía el área entera de traslados.
   */
  transferView: 'transfer.view',
  /**
   * Despachar un traslado de stock: es el permiso que descuenta del depósito de origen, así que lo
   * exige el alta y no el listado —que se abre con `transfer.view`—.
   */
  transferDispatch: 'transfer.dispatch',
  /**
   * Confirmar la recepción de un traslado en viaje. Además del permiso, el backend exige estar
   * operando en la sucursal de **destino**: tenerlo no alcanza para recibir desde otra sucursal.
   */
  transferReceive: 'transfer.receive',

  /**
   * Catálogo de campos extra de empleado —«talle de uniforme», «obra social»—. Es catálogo de
   * empresa con permiso propio, como las opciones de variante: quien carga empleados no
   * necesariamente decide qué campos existen. Completar un campo en un empleado no pide esta
   * familia sino `employee.edit`.
   */
  employeeAttributeView: 'employee_attribute.view',
  employeeAttributeCreate: 'employee_attribute.create',
  employeeAttributeEdit: 'employee_attribute.edit',
  employeeAttributeDelete: 'employee_attribute.delete',

  /**
   * Empleados: el ABM general y los tres por tipo. Crear y editar desde cualquier ficha piden
   * `employee.create` / `employee.edit`. Borrar desde la carpeta de un tipo **revoca esa especialidad**
   * y por eso pide `employee.specialty_assign`; dar de baja al empleado entero pide `employee.delete`.
   */
  employeeView: 'employee.view',
  employeeCreate: 'employee.create',
  employeeEdit: 'employee.edit',
  employeeDelete: 'employee.delete',
  employeeSpecialtyAssign: 'employee.specialty_assign',

  /**
   * Vincular una ficha del directorio con su usuario. Es propio y no se pliega dentro de
   * `customer.edit`: si lo estuviera, quien administra clientes acuñaría logins. El vínculo pide además
   * `user.create` para un usuario nuevo o `user.edit` para uno que ya existe.
   */
  partyUserLink: 'party.user_link',

  supplierView: 'supplier.view',
  supplierCreate: 'supplier.create',
  supplierEdit: 'supplier.edit',
  supplierDelete: 'supplier.delete',

  /**
   * Usuarios y roles. Son permisos del Core (`BasePermissionEnum`), no del `PermissionEnum` del
   * proyecto. Hasta que el backend los usó para gatear sus controllers, el ABM era sólo del SysAdmin y
   * cualquier otro recibía `403` aunque tuviera el permiso.
   *
   * El administrador de la empresa tiene `user.*` y `role.*`: administra los usuarios de su empresa y
   * arma los roles de su empresa; los de sistema siguen siendo del SysAdmin.
   */
  userView: 'user.view',
  userCreate: 'user.create',
  userEdit: 'user.edit',
  userDelete: 'user.delete',

  roleView: 'role.view',
  roleCreate: 'role.create',
  roleEdit: 'role.edit',
  roleDelete: 'role.delete',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];
