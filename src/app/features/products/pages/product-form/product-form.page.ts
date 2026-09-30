import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { RouterLink } from '@angular/router';
import { NEW_ASSEMBLY_PATH } from '../../../assemblies/assemblies.paths';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  FormField,
  ValidationError,
  applyEach,
  disabled,
  form,
  max,
  maxLength,
  min,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, firstValueFrom, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { BranchDto } from '../../../../core/branch/branch.model';
import { BranchesApiService } from '../../../../core/branch/branches-api.service';
import { VersionConflictService } from '../../../../core/concurrency/version-conflict.service';
import { ConfigurationStore } from '../../../../core/configuration/configuration.store';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { isExpirationOffered, isStockTrackingOffered } from '../../../../core/features/feature-flags';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  readApiErrorData,
  resolveApiErrorMessage,
} from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import {
  HasUnsavedChanges,
  trackUnsavedChanges,
} from '../../../../core/unsaved-changes/unsaved-changes.tracker';
import { toPriceRounding } from '../../../../core/pricing/price-rounding';
import { padScaleSample, scaleCodeLengthOf } from '../../../../core/product/scale-format.model';
import {
  PickerProduct,
  isVirtualKitPick,
} from '../../../../core/product-picker/product-picker.model';
import { ProductPickerService } from '../../../../core/product-picker/product-picker.service';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { ProductStockTabComponent } from '../../components/product-stock-tab/product-stock-tab.component';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { PRODUCTS_PATH } from '../../../../core/product/product-page.paths';
import { productPriceHistoryPath } from '../../products.paths';
import { PRICE_HISTORY_VIEW_PERMISSION } from '../../data-access/price-history.model';
import {
  COST_METHODS,
  CategoryAttributeDto,
  CategoryOption,
  DEFAULT_EXPIRATION_CONTROL,
  DEFAULT_KIT_PRICING,
  DEFAULT_PRODUCT_TYPE,
  DEFAULT_STOCK_TRACKING,
  DEFAULT_TAX_RATE,
  DEFAULT_UNIT_MEASURE,
  EXPIRATION_CONTROLS,
  ExpirationControl,
  KIT_PRICINGS,
  KitPricing,
  PRICE_RULE_VIEW_PERMISSION,
  PRODUCT_BRANCH_ASSIGN_PERMISSION,
  PRODUCT_KIT_EDIT_PERMISSION,
  PRODUCT_TYPES,
  ProductType,
  SUPPLIER_VIEW_PERMISSION,
  STOCK_TRACKING_MODES,
  StockTracking,
  PriceListDto,
  ProductDto,
  ProductKitItemPayload,
  ProductPriceRuleDto,
  ProductSavePayload,
  UNIT_MEASURES,
  UuidNameRef,
  isArchivedProduct,
  isKit,
  rulePercentByPriceListUuid,
  toExpirationControl,
  toKitPricing,
  toProductType,
  toStockTracking,
  trackingSupportsExpiration,
  typeRequiresNoStock,
  isAssembledKit,
  KIT_MODES,
  toKitMode,
  DEFAULT_KIT_MODE,
  KitMode,
} from '../../data-access/product.model';
import { ProductsApiService } from '../../data-access/products-api.service';

const NAME_MAX_LENGTH = 255;
const SKU_MAX_LENGTH = 100;
const BARCODE_MAX_LENGTH = 100;
const PACKAGING_NAME_MAX_LENGTH = 255;
/** Largo de `products.scale_code`: el código entra en la etiqueta, así que es corto por diseño. */
const SCALE_CODE_MAX_LENGTH = 20;
/** El código del ejemplo del documento funcional, que el hint recorta al largo configurado. */
const SCALE_CODE_SAMPLE = '123';
/** La etiqueta entera es numérica, así que el tramo del código también lo es. */
const SCALE_CODE_DIGITS = /^\d+$/;
const ATTRIBUTE_VALUE_MAX_LENGTH = 255;

/**
 * Cuántos proveedores ofrece el autocompletado a la vez. Los filtra la pantalla sobre la lista que
 * ya trajo entera: son pocos —un puñado por empresa— y buscarlos contra el backend en cada tecla
 * sería una consulta por letra para recortar una lista que ya está en memoria.
 */
const SUPPLIER_SUGGESTIONS_LIMIT = 8;

/** `taxRate` viaja como porcentaje (`21` = 21 %), igual que el default del backend. */
const TAX_RATE_MAX = 100;

/** Índice de cada solapa; el submit inválido salta a la primera que tenga errores. */
const TAB_GENERAL = 0;
const TAB_PRICING = 1;
const TAB_INVENTORY = 2;
const TAB_PACKAGINGS = 3;
/**
 * Stock. No participa de `firstInvalidTab()`: no tiene campos del producto, sino los de una
 * operación aparte contra `/stock/adjustment`.
 *
 * Va **después** de Empaques y no antes: es la única solapa condicional, y con una condicional en
 * el medio los índices de las que siguen se corren según el producto. Al ir última, su ausencia no
 * mueve a ninguna otra.
 */
const TAB_STOCK = 4;

/** Valor de `?tab=` con el que se entra directo a la solapa de stock desde la grilla. */
const STOCK_TAB_QUERY_VALUE = 'stock';

/** Valor de `?tab=` con el que «Editar precios» del listado entra directo a la solapa Precios. */
const PRICING_TAB_QUERY_VALUE = 'prices';

/** A qué solapa entra cada `?tab=`; cualquier otro valor abre la primera. */
const TAB_BY_QUERY_VALUE: Readonly<Record<string, number>> = {
  [STOCK_TAB_QUERY_VALUE]: TAB_STOCK,
  [PRICING_TAB_QUERY_VALUE]: TAB_PRICING,
};

/** Decimales con los que la pantalla previsualiza precios; el redondeo real lo hace la sucursal. */
const PRICE_DECIMALS = 2;

/** Decimales de los porcentajes de rentabilidad. */
const PERCENT_DECIMALS = 1;

/**
 * Un precio del producto en una lista, tal como se edita en la grilla de la solapa Precios.
 *
 * `price` es el neto —lo único que se persiste— y `finalPrice` el mismo precio con el impuesto del
 * producto encima, que es lo que termina pagando el cliente (`OrderItemBuilderService` arma la línea
 * como `neto + neto × taxRate/100`). Los dos se editan y cada uno recalcula al otro.
 */
interface ProductPriceFormEntry {
  priceListUuid: string;
  /** `null` = la lista queda sin precio; el backend sólo hace upsert de lo que recibe. */
  price: number | null;
  /** Derivado de `price` y de la alícuota: no viaja al backend, que lo recalcula al vender. */
  finalPrice: number | null;
}

/**
 * Un atributo de la categoría elegida. Arrastra `name` y `type` porque la grilla es dinámica: el
 * tipo decide qué control se renderiza y cómo se valida el valor antes de mandarlo.
 */
interface ProductAttributeFormEntry {
  attributeUuid: string;
  name: string;
  type: string;
  /** Siempre string: es lo que el backend normaliza y valida según `type`. */
  rawValue: string;
}

/**
 * Rentabilidad de una lista contra el costo de la sucursal. Las dos lecturas del mismo número son
 * las que usa el módulo de reglas de precio, así que la grilla muestra ambas en vez de elegir una.
 */
interface ProductMarginRow {
  priceListUuid: string;
  name: string;
  /** Precio neto de la lista: el impuesto no entra, no es ganancia. */
  price: number;
  /** Precio neto − costo. */
  profit: number;
  /** Ganancia sobre el precio (`MARGIN_PERCENT`); `null` con precio 0, que no admite división. */
  marginPercent: number | null;
  /** Ganancia sobre el costo (`MARKUP_PERCENT`). */
  markupPercent: number;
}

/**
 * Una fila de la grilla de códigos de barras. Un producto se lee con varios —el del fabricante, el
 * de la caja, el reetiquetado— y uno solo es el principal: el que la grilla de productos muestra y
 * el que el backend copia al campo único `barcode`.
 */
interface ProductBarcodeFormEntry {
  barcode: string;
  isPrimary: boolean;
}

/**
 * Una fila de la grilla de empaques. El empaque **no es un producto** (RN-16): no tiene stock ni
 * precio, es un factor de conversión que se aplica al cargar una línea de compra o de venta.
 *
 * El `uuid` viaja para que renombrar «Caja x 12» conserve la fila —y con ella su código de barras—
 * en vez de dar de baja una y crear otra. En una fila nueva es `null`.
 */
interface ProductPackagingFormEntry {
  uuid: string | null;
  name: string;
  factor: number | null;
  isPurchaseDefault: boolean;
  isSaleDefault: boolean;
  /** El código de la caja. Vive en `product_barcodes`, pero se edita acá porque es del empaque. */
  barcode: string;
}

/**
 * Una fila de la composición de un kit. El componente se elige del selector de productos, así que
 * la fila llega con su nombre, su saldo y su precio ya resueltos: es lo que permite mostrar «alcanza
 * para» sin volver a preguntar por cada uno.
 *
 * `stock` en `null` es un componente que **no lleva stock** —un servicio dentro del combo—: no
 * limita la disponibilidad, y decirlo es distinto de mostrar un cero (RN-07).
 */
interface ProductKitItemFormEntry {
  uuid: string | null;
  componentUuid: string;
  componentName: string;
  componentSku: string | null;
  quantity: number | null;
  stock: number | null;
  listPrice: number | null;
  componentCost: number | null;
  limitsAvailability: boolean;
}

interface ProductFormModel {
  name: string;
  sku: string;
  barcodes: ProductBarcodeFormEntry[];
  packagings: ProductPackagingFormEntry[];
  /** Composición del kit. Vacía en todo producto que no es `KIT`. */
  kitItems: ProductKitItemFormEntry[];
  /** De dónde sale el precio del combo. Sólo se usa con `type = KIT`. */
  kitPricing: KitPricing;
  kitMode: KitMode;
  /** Descuento sobre la suma de los componentes; sólo con `SUM_COMPONENTS`. */
  kitDiscountPercent: number | null;
  categoryUuid: string | null;
  brandUuid: string | null;
  unitMeasure: string;
  taxRate: number | null;
  lowStock: number | null;
  optimalStock: number | null;
  /**
   * Los tres ejes del producto. Se combinan libremente salvo por dos restricciones, que el esquema
   * traduce a campos deshabilitados —nunca ocultos— para que se vea por qué no se puede: `SERVICE`
   * y `KIT` fuerzan `stockTracking = NONE`, y el vencimiento sólo se habilita con `BATCH`/`SERIAL`.
   */
  productType: ProductType;
  stockTracking: StockTracking;
  expirationControl: ExpirationControl;
  expirationAlertDays: number | null;
  /** Costo declarado: el único costo posible de un producto que no lleva stock. */
  standardCost: number | null;
  /**
   * El producto se pesa en una balanza de mostrador. Sólo tiene sentido con una unidad que admita
   * decimales: una balanza informa 1,250 kg, y en `UNIT` esa lectura se truncaría a 1.
   */
  isWeighable: boolean;
  /** Código interno de balanza. **No** es un código de barras y no entra en la grilla (RN-18). */
  scaleCode: string;
  isForSale: boolean;
  isForPurchase: boolean;
  prices: ProductPriceFormEntry[];
  attributes: ProductAttributeFormEntry[];
  branchUuids: string[];
  /** Uuids de los roles `SUPPLIER` a los que se le compra el producto. */
  supplierUuids: string[];
}

/**
 * Alta y edición de producto: el `POST /product/save` persiste en una sola operación el producto,
 * sus valores de atributos de categoría, sus precios por lista y las sucursales donde se ofrece,
 * así que la pantalla los agrupa en tres solapas sobre un único formulario.
 *
 * La edición es la misma pantalla con el `uuid` de la ruta: se prellena con
 * `GET /product/uuid/{uuid}` —el único que trae atributos, precios y sucursales— y reenvía el
 * `uuid` en el payload, con lo que el backend pide `product.edit` en vez de `product.create`.
 *
 * En la edición se consulta además la regla de precio que alcanza al producto en la sucursal activa
 * (`GET /price-rule/product/{uuid}`): las listas que esa regla recalcula tienen su precio derivado
 * del costo, así que la grilla las muestra deshabilitadas y el payload las omite.
 *
 * La solapa Precios previsualiza dos cosas que el backend no persiste y por lo tanto la pantalla
 * calcula: el precio final con impuestos —la otra punta editable de cada precio— y la rentabilidad
 * de cada lista contra el `cost` de la sucursal que trae el detalle del producto.
 *
 * El historial de precios no se dibuja acá: la solapa sólo enlaza a su pantalla, que es donde la
 * serie se grafica con su propia ventana de fechas.
 *
 * La solapa Stock es la excepción a que todo esto sea un solo formulario: muestra la distribución
 * del producto por depósito y aplica ajustes de inventario, que son operaciones aparte contra
 * `/stock/adjustment` y se confirman por su cuenta. Guardar el producto no las incluye.
 */
@Component({
  selector: 'app-product-form-page',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatTooltipModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
    CurrencyDisplayComponent,
    LoadStateComponent,
    PageHeaderComponent,
    ProductStockTabComponent,
    RouterLink,
  ],
  providers: [ProductsApiService],
  templateUrl: './product-form.page.html',
  styleUrl: './product-form.page.css',
})
export class ProductFormPage implements OnInit, HasUnsavedChanges {
  private readonly productsApi = inject(ProductsApiService);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly versionConflict = inject(VersionConflictService);
  private readonly configuration = inject(ConfigurationStore);
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly injector = inject(Injector);
  // Vive en `core/`: lo comparten el POS, la compra y ahora la composición del kit. Un
  // `*ApiService` de feature no se podría inyectar desde acá (lo proveen sus propias pantallas).
  private readonly productPicker = inject(ProductPickerService);

  protected readonly LoadState = LoadState;
  protected readonly unitMeasures = UNIT_MEASURES;
  protected readonly productTypes = PRODUCT_TYPES;
  protected readonly kitPricings = KIT_PRICINGS;
  protected readonly expirationControls = EXPIRATION_CONTROLS;
  protected readonly generalTab = TAB_GENERAL;

  private readonly barcodeInputs = viewChildren<ElementRef<HTMLInputElement>>('barcodeInput');
  private readonly packagingInputs = viewChildren<ElementRef<HTMLInputElement>>('packagingInput');

  /**
   * Unidades que el backend ya rechazó para un pesable, aprendidas de
   * `WEIGHABLE_REQUIRES_FRACTIONAL_UNIT` (`data.unitMeasure`).
   *
   * Es la salida al problema de que la pantalla no puede saber qué unidades admiten decimales sin
   * replicar `UnitMeasure.decimalPlaces` —que es justamente lo que no se hace acá—: en vez de
   * duplicar la tabla, se guarda lo que el backend dijo. Un rechazo enseña, y de ahí en adelante la
   * combinación se marca en la pantalla sin ir y volver.
   *
   * Que sea una **validación** y no el error de servidor de `submit()` es lo que la hace
   * desaparecer sola: el error de servidor se limpia sólo cuando cambia *su* campo, y acá el campo
   * que el usuario cambia para arreglarlo suele ser el otro —la unidad—, así que quedaba trabado el
   * guardado sin nada visible que lo explicara.
   */
  private readonly unitsRejectedForWeighable = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * Cuántos dígitos tiene el código de balanza para esta empresa, o `null` si no se puede saber.
   *
   * Sale de `sale.scaleBarcodeFormat` —el mismo texto que edita la pantalla de configuración— y no
   * de un largo elegido acá: el código que se guarda tiene que ser **exactamente** el tramo que el
   * backend recorta de la etiqueta (`ScaleBarcodeParser.read`), y esa resolución es una comparación
   * literal contra `products.scale_code`. Con el formato `2:5:5:WEIGHT`, un producto guardado como
   * `123` no lo encuentra nunca ninguna etiqueta: la balanza imprime `00123`.
   *
   * `null` es «no hay largo que exigir» y cubre los dos casos en los que inventar uno sería peor
   * que no validar: la empresa que no vende pesables y no configuró nada, y la configuración que
   * todavía no se leyó. Ahí el campo queda con el largo de la columna y nada más.
   */
  protected readonly scaleCodeLength = computed(() =>
    scaleCodeLengthOf(this.configuration.scaleBarcodeFormat()),
  );

  /**
   * El formato está sin configurar y ya se sabe que lo está: la lectura del store terminó y no
   * trajo nada utilizable. Es lo que separa «la empresa no configuró la balanza» de «todavía no
   * llegó la respuesta», que se ven igual desde `scaleCodeLength()` y no significan lo mismo para
   * quien está cargando un pesable.
   */
  protected readonly scaleFormatMissing = computed(
    () => this.configuration.loaded() && this.scaleCodeLength() === null,
  );

  /** El código de ejemplo del hint, con el largo que declara el formato: `00123`. */
  protected readonly scaleCodeSample = computed(() =>
    padScaleSample(SCALE_CODE_SAMPLE, this.scaleCodeLength() ?? 0),
  );

  /**
   * Control de existencias con el que se cargó el producto. Cambiarlo reescribe cómo se lleva el
   * inventario (RN-02), así que guardar con otro valor pide confirmación antes: es el riesgo de
   * activar lotes en una ferretería y arrepentirse. En el alta es `null`: no hay historia.
   */
  private readonly loadedStockTracking = signal<StockTracking | null>(null);

  /** `uuid` de la ruta: sólo lo trae `:uuid/edit`, y es lo que distingue edición de alta. */
  protected readonly productUuid = this.route.snapshot.paramMap.get('uuid');
  protected readonly isEdit = this.productUuid !== null;

  /**
   * Si el producto que se está mirando está **archivado**: salió del catálogo y no vuelve (ADR 0001).
   *
   * La ficha se abre igual —quien llega desde el indicador de un comprobante viejo necesita poder
   * abrirla— pero no se edita: `POST /product/save` responde `400 PRODUCT_ARCHIVED_READ_ONLY`, así
   * que un formulario editable acá sólo podía terminar en un error. Se apagan los campos, se saca el
   * botón de guardar y un banner arriba dice por qué, que es lo que convierte una pantalla rota en
   * una pantalla de consulta.
   *
   * Es un `signal` y no un `computed` del producto cargado porque el formulario ya no lo conserva:
   * `hydrate()` lo vuelca y lo suelta.
   */
  protected readonly archived = signal(false);

  /** Nombre ya guardado del producto, para el breadcrumb, el toast y la solapa de stock. */
  protected readonly productName = signal('');
  /**
   * El modelo del que el producto es variante, para que la solapa Stock lo diga en su encabezado
   * (wireframe `1f`): un producto puede ser `SERIAL` y variante a la vez.
   */
  protected readonly productModel = signal<UuidNameRef | null>(null);

  /**
   * Decimales que admite la unidad del producto, tal cual los declara el backend. La solapa de
   * stock mide con ellos, y salen de la lectura y no de `unitMeasure` para no replicar acá la
   * tabla de precisiones que vive del otro lado (ver `core/product/quantity-precision.ts`).
   */
  protected readonly unitDecimalPlaces = signal<number | null>(null);

  /**
   * Mandar `branches` sin `product.branch_assign` es un 403 —incluso con `product.edit`—, así que
   * sin el permiso la grilla no se muestra y el campo se omite del payload.
   */
  protected readonly canAssignBranches = this.auth.hasPermission(PRODUCT_BRANCH_ASSIGN_PERMISSION);

  /**
   * Listar proveedores exige `supplier.view`. Sin el permiso la sección queda de sólo lectura —los
   * ya vinculados llegan con nombre en el detalle del producto— y `suppliers` se omite del payload,
   * que es como se deja la relación intacta.
   */
  protected readonly canViewSuppliers = this.auth.hasPermission(SUPPLIER_VIEW_PERMISSION);

  /** Consultar la regla del producto exige `price_rule.view`; sin el permiso sería un 403. */
  private readonly canViewPriceRules = this.auth.hasPermission(PRICE_RULE_VIEW_PERMISSION);

  /** El historial vive en su propia pantalla y exige `price_history.view` para poder consultarse. */
  protected readonly canViewPriceHistory = this.auth.hasPermission(PRICE_HISTORY_VIEW_PERMISSION);

  protected readonly loadState = signal<LoadState>(LoadState.Loading);
  protected readonly stockTab = TAB_STOCK;
  protected readonly selectedTab = signal(
    // `?tab=` es cómo la grilla de productos entra directo a lo que la fila ofrecía: el ajuste de
    // stock y la edición de precios llevan a esta pantalla en vez de a un diálogo propio, así cada
    // flujo vive en un solo lugar.
    TAB_BY_QUERY_VALUE[this.route.snapshot.queryParamMap.get('tab') ?? ''] ?? TAB_GENERAL,
  );

  protected readonly brands = signal<readonly UuidNameRef[]>([]);
  protected readonly categories = signal<readonly CategoryOption[]>([]);
  protected readonly priceLists = signal<readonly PriceListDto[]>([]);
  protected readonly branches = signal<readonly BranchDto[]>([]);
  protected readonly suppliers = signal<readonly UuidNameRef[]>([]);
  protected readonly attributesLoading = signal(false);

  /** Lo tipeado en el buscador de proveedores. No es parte del producto: no viaja al guardar. */
  protected readonly supplierSearch = signal('');

  /**
   * Nombre de cada proveedor ya vinculado, tal como lo trajo el detalle del producto. Es lo que
   * permite dibujar el chip de uno que no está entre las opciones —porque la empresa tiene más de
   * los que entran en una página, o porque el usuario no puede listarlos— en vez de esconderlo y
   * desvincularlo en silencio al guardar.
   */
  private readonly linkedSupplierNames = signal<ReadonlyMap<string, string>>(new Map());

  /**
   * Regla de precio que alcanza al producto en la sucursal activa, o `null` cuando ninguna lo hace.
   * En el alta siempre es `null`: el producto todavía no existe, así que no hay regla que resolver.
   */
  protected readonly priceRule = signal<ProductPriceRuleDto | null>(null);

  /**
   * Costo unitario del producto en la sucursal activa y el método con el que se resolvió. Los trae
   * el detalle: el costo lo persiste cada entrada de stock, así que en el alta no hay ninguno.
   */
  protected readonly cost = signal<number | null>(null);
  /**
   * Saldo del producto en la sucursal, tal como lo trajo la lectura. Sólo lo usa el selector de modo
   * del kit: es lo que RN-28 mira para trabar la vuelta a virtual.
   */
  private readonly loadedStock = signal<number | null>(null);
  private readonly costMethod = signal<string | null>(null);

  /**
   * Sucursales a las que el producto ya estaba vinculado pero que la grilla no muestra por estar
   * inactivas. Se reenvían tal cual: `branches` es la lista completa para el backend, así que
   * omitirlas desvincularía en silencio al producto de una sucursal que sólo está apagada.
   */
  private hiddenBranchUuids: readonly string[] = [];

  /**
   * Versión que traía el producto en la lectura que llenó el formulario. Se reenvía al guardar para
   * que el backend rechace la edición si alguien más lo tocó mientras tanto. `undefined` en el alta,
   * donde todavía no hay registro contra el cual compararla.
   */
  private productVersion: number | undefined;

  private readonly priceListsByUuid = computed(
    () => new Map(this.priceLists().map((list) => [list.uuid, list])),
  );

  /**
   * Listas cuyo precio calcula la regla en esta sucursal, con su porcentaje. Una regla sin listas
   * acá se resuelve pero no recalcula nada, y entonces la grilla queda toda editable.
   */
  private readonly rulePercentByPriceList = computed(() =>
    rulePercentByPriceListUuid(this.priceRule()),
  );

  /** Hay al menos un precio que maneja la regla, que es lo que la solapa tiene que explicar. */
  protected readonly hasRuleManagedPrices = computed(() => this.rulePercentByPriceList().size > 0);

  /**
   * Con qué criterio cierra el precio que calcula la regla (`v74`/`v75`). Explica por qué un precio
   * bloqueado quedó en un número «raro» —o demasiado redondo— sin tener que abrir la regla.
   *
   * Es un método y no un `computed` para que lo reevalúe el mismo ciclo que redibuja la nota al
   * cambiar de idioma: `translate.instant` lee la traducción vigente, no una señal.
   */
  protected ruleRoundingLabel(): string {
    const rule = this.priceRule();
    const rounding = toPriceRounding(rule?.roundingMode, rule?.roundingDirection);

    return [
      this.translate.instant(`priceRules.roundingModes.${rounding.mode}`),
      this.translate.instant(`priceRules.roundingDirections.${rounding.direction}`),
    ].join(' · ');
  }

  /**
   * Sin costo no hay margen que calcular: un costo nulo es un producto que todavía no entró por una
   * compra, y uno en cero daría un recargo infinito.
   */
  protected readonly hasCost = computed(() => (this.cost() ?? 0) > 0);

  /**
   * Clave de traducción del método de costeo de la sucursal. `null` para un método que la pantalla
   * no conoce: antes que mostrar la clave cruda, la leyenda se omite.
   */
  protected readonly costMethodKey = computed(() => {
    const method = this.costMethod();
    return method !== null && (COST_METHODS as readonly string[]).includes(method)
      ? `products.form.margins.costMethods.${method}`
      : null;
  });

  /**
   * Rentabilidad de cada lista con precio cargado, contra el costo de la sucursal. Se recalcula
   * mientras se tipea porque sale del mismo modelo que la grilla de precios.
   */
  protected readonly marginRows = computed<ProductMarginRow[]>(() => {
    const cost = this.cost();
    if (cost === null || cost <= 0) {
      return [];
    }

    return this.model()
      .prices.filter((entry) => entry.price !== null)
      .map((entry) => {
        const price = entry.price as number;
        const profit = roundPrice(price - cost);

        return {
          priceListUuid: entry.priceListUuid,
          name: this.priceListName(entry.priceListUuid),
          price,
          profit,
          marginPercent: price === 0 ? null : roundPercent((profit / price) * 100),
          markupPercent: roundPercent((profit / cost) * 100),
        };
      });
  });

  private readonly model = signal<ProductFormModel>({
    name: '',
    sku: '',
    barcodes: [],
    packagings: [],
    kitItems: [],
    kitPricing: DEFAULT_KIT_PRICING,
    kitMode: DEFAULT_KIT_MODE,
    kitDiscountPercent: null,
    categoryUuid: null,
    brandUuid: null,
    unitMeasure: DEFAULT_UNIT_MEASURE,
    taxRate: DEFAULT_TAX_RATE,
    lowStock: null,
    optimalStock: null,
    productType: DEFAULT_PRODUCT_TYPE,
    stockTracking: DEFAULT_STOCK_TRACKING,
    expirationControl: DEFAULT_EXPIRATION_CONTROL,
    expirationAlertDays: null,
    standardCost: null,
    isWeighable: false,
    scaleCode: '',
    isForSale: true,
    isForPurchase: true,
    prices: [],
    attributes: [],
    branchUuids: [],
    supplierUuids: [],
  });

  /**
   * La foto se toma cuando la pantalla termina de cargar —incluidos los atributos de la categoría,
   * que llegan en una segunda request— y otra vez después de guardar, así que `unsavedChangesGuard`
   * sólo pregunta por lo que el usuario escribió y todavía no persistió.
   */
  private readonly changes = trackUnsavedChanges(this.model);

  /** Público, sin `protected`: lo lee `unsavedChangesGuard` desde afuera del componente. */
  readonly hasUnsavedChanges = this.changes.hasUnsavedChanges;

  protected readonly productForm = form(this.model, (path) => {
    // En la raíz: el archivado no se edita en **ningún** campo, y el `disabled` del esquema baja a
    // todos los descendientes. Lo que no viaja por `[formField]` —los selects y los toggles que se
    // manejan con `[value]` + `(change)`— lo apaga el template con `archived()`.
    disabled(path, { when: () => this.archived() });

    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);

    required(path.sku);
    maxLength(path.sku, SKU_MAX_LENGTH);

    applyEach(path.barcodes, (entry) => {
      required(entry.barcode);
      maxLength(entry.barcode, BARCODE_MAX_LENGTH);
      // Mismo rechazo que `ProductBarcodeService.normalize`, antes de gastar el request: el
      // backend compara sin distinguir mayúsculas ni espacios alrededor.
      validate(entry.barcode, ({ value, valueOf }) => {
        const code = normalizeBarcode(value());
        if (!code) {
          return null;
        }

        const repeated = valueOf(path.barcodes).filter(
          (row) => normalizeBarcode(row.barcode) === code,
        );
        return repeated.length > 1 ? { kind: 'duplicateBarcode' } : null;
      });
    });

    // Los empaques replican las tres validaciones del backend antes de gastar el request:
    // `PACKAGING_NAME_REQUIRED`, `PACKAGING_FACTOR_INVALID` y `PACKAGING_DEFAULT_DUPLICATED`.
    applyEach(path.packagings, (entry) => {
      required(entry.name);
      maxLength(entry.name, PACKAGING_NAME_MAX_LENGTH);
      required(entry.factor);
      // Estrictamente mayor que cero: con cero la conversión de la línea sería una división por
      // cero, y es el mismo CHECK `ck_product_packagings_factor` del otro lado.
      validate(entry.factor, ({ value }) => {
        const factor = value();
        return factor !== null && factor <= 0 ? { kind: 'packagingFactor' } : null;
      });

      maxLength(entry.barcode, BARCODE_MAX_LENGTH);
      // Un código resuelve a un solo producto, y las dos grillas comparten esa unicidad: se compara
      // contra los códigos sueltos además de contra los otros empaques.
      validate(entry.barcode, ({ value, valueOf }) => {
        const code = normalizeBarcode(value());
        if (!code) {
          return null;
        }

        const inPackagings = valueOf(path.packagings).filter(
          (row) => normalizeBarcode(row.barcode) === code,
        ).length;
        const inBarcodes = valueOf(path.barcodes).filter(
          (row) => normalizeBarcode(row.barcode) === code,
        ).length;
        return inPackagings + inBarcodes > 1 ? { kind: 'duplicateBarcode' } : null;
      });
    });

    // La composición del kit: las mismas tres validaciones que hace `ProductKitService` antes de
    // gastar el request. La cuarta —que el componente no sea otro kit (RN-10)— se corta al elegirlo,
    // porque ahí se puede explicar sobre el producto que se acaba de tocar.
    applyEach(path.kitItems, (entry) => {
      required(entry.quantity);
      // Estrictamente mayor que cero: la cantidad es el divisor del disponible derivado, así que con
      // cero el kit sería infinito. Mismo CHECK `ck_product_kit_items_quantity` del otro lado.
      validate(entry.quantity, ({ value }) => {
        const quantity = value();
        return quantity !== null && quantity <= 0 ? { kind: 'kitQuantity' } : null;
      });
    });

    // Un kit sin componentes no existe: su disponible se deriva de las partes, y sin ellas no habría
    // nada que descontar al venderlo (`KIT_REQUIRES_COMPONENTS`).
    validate(path.kitItems, ({ value, valueOf }) =>
      isKit(valueOf(path.productType)) && value().length === 0 ? { kind: 'kitEmpty' } : null,
    );

    // El descuento sólo existe cuando el precio es la suma de las partes, y es un porcentaje.
    disabled(path.kitDiscountPercent, {
      when: ({ valueOf }) =>
        !isKit(valueOf(path.productType)) || valueOf(path.kitPricing) !== 'SUM_COMPONENTS',
    });
    min(path.kitDiscountPercent, 0);
    max(path.kitDiscountPercent, 100);

    // El default dice con cuál arranca la línea, así que no puede haber dos para la misma
    // operación: con dos, cuál gana lo decidiría el orden en que se guardaron. Compra y venta se
    // cuentan por separado —la ferretería compra por bulto y vende por unidad—.
    validate(path.packagings, ({ value }) => {
      const rows = value();
      if (rows.filter((row) => row.isPurchaseDefault).length > 1) {
        return { kind: 'packagingPurchaseDefault' };
      }
      return rows.filter((row) => row.isSaleDefault).length > 1
        ? { kind: 'packagingSaleDefault' }
        : null;
    });

    // Un pesable necesita una unidad que admita decimales —la balanza informa 1,250 kg y con
    // `UNIT` esa lectura se truncaría a 1—, pero **quién lo decide es el backend**: la precisión la
    // declara `UnitMeasure.decimalPlaces` y el front no replica esa tabla a propósito (ver
    // `core/product/quantity-precision.ts`). Una copia acá dejaría la pantalla midiendo con otra
    // vara que la que aplica el 400 en cuanto se agregue una unidad del otro lado.
    //
    // Así que el check queda habilitado, el hint dice la condición, y
    // `WEIGHABLE_REQUIRES_FRACTIONAL_UNIT` se marca sobre el campo al guardar, igual que el SKU
    // repetido. Lo único que se deshabilita es el código: sin pesable no hay etiqueta que resolver.
    disabled(path.scaleCode, { when: ({ valueOf }) => !valueOf(path.isWeighable) });
    maxLength(path.scaleCode, SCALE_CODE_MAX_LENGTH);

    // El código tiene que ser el tramo exacto que el backend recorta de la etiqueta: mismos dígitos
    // y mismo largo que declara `sale.scaleBarcodeFormat`, porque la resolución del POS compara
    // `products.scale_code` literal contra lo que leyó (`ScaleBarcodeParser.read`). Un `123` con el
    // formato `2:5:5:WEIGHT` guarda bien y después no lo encuentra ninguna etiqueta —la balanza
    // imprime `00123`—, que es el peor de los desenlaces: no falla al cargar, falla en el mostrador.
    //
    // Sin formato configurado no se exige largo (`scaleCodeLength()` es `null`): ahí no hay contra
    // qué comparar, y un largo inventado por la pantalla rechazaría códigos que el backend acepta.
    validate(path.scaleCode, ({ value, valueOf }) => {
      const length = this.scaleCodeLength();
      const code = value().trim();
      if (!valueOf(path.isWeighable) || !code || length === null) {
        return null;
      }

      if (!SCALE_CODE_DIGITS.test(code)) {
        return { kind: 'scaleCodeDigits' };
      }
      return code.length === length ? null : { kind: 'scaleCodeLength', length };
    });
    validate(path.isWeighable, ({ value, valueOf }) =>
      value() && this.unitsRejectedForWeighable().has(valueOf(path.unitMeasure))
        ? { kind: 'weighableUnitRejected' }
        : null,
    );

    required(path.categoryUuid);
    required(path.unitMeasure);

    required(path.taxRate);
    min(path.taxRate, 0);
    max(path.taxRate, TAX_RATE_MAX);

    // Los ejes: lo que la combinación no permite queda deshabilitado, no oculto (RN-01). Un
    // servicio o un kit no llevan stock, y sin partidas ni series no hay dónde guardar un
    // vencimiento. Los handlers dejan además el valor forzado en el modelo, así el payload es el
    // que el backend acepta y no uno que el usuario no pudo ver.
    disabled(path.stockTracking, {
      when: ({ valueOf }) =>
        typeRequiresNoStock(valueOf(path.productType), valueOf(path.kitMode)),
    });
    disabled(path.expirationControl, {
      when: ({ valueOf }) => !trackingSupportsExpiration(valueOf(path.stockTracking)),
    });
    disabled(path.expirationAlertDays, {
      when: ({ valueOf }) =>
        !trackingSupportsExpiration(valueOf(path.stockTracking)) ||
        valueOf(path.expirationControl) === 'NONE',
    });
    min(path.expirationAlertDays, 0);
    validate(path.expirationAlertDays, ({ value }) => {
      const days = value();
      return days !== null && !Number.isInteger(days) ? { kind: 'integer' } : null;
    });

    // Sin control de existencias no hay umbrales que vigilar, y el costo pasa a declararse a mano
    // porque no hay lote que lo aporte (§8). Con stock es al revés.
    disabled(path.lowStock, { when: ({ valueOf }) => valueOf(path.stockTracking) === 'NONE' });
    disabled(path.optimalStock, {
      when: ({ valueOf }) => valueOf(path.stockTracking) === 'NONE',
    });
    disabled(path.standardCost, {
      when: ({ valueOf }) => valueOf(path.stockTracking) !== 'NONE',
    });
    min(path.standardCost, 0);

    // Mismos umbrales que valida `ProductService.validateStockThresholds`.
    min(path.lowStock, 0);
    min(path.optimalStock, 0);
    validate(path.lowStock, ({ value, valueOf }) => {
      const lowStock = value();
      const optimalStock = valueOf(path.optimalStock);
      if (lowStock === null || optimalStock === null) {
        return null;
      }

      return lowStock > optimalStock ? { kind: 'stockThresholds' } : null;
    });

    applyEach(path.prices, (price) => {
      min(price.price, 0);
      min(price.finalPrice, 0);

      // El precio de una lista que recalcula la regla sale del costo, no del formulario: lo que se
      // escribiera acá viviría hasta la próxima compra, que lo volvería a pisar. Se bloquean las dos
      // puntas, porque editar el final es editar el neto por la vía inversa.
      disabled(price.price, {
        when: ({ valueOf }) => this.isRuleManaged(valueOf(price.priceListUuid)),
      });
      disabled(price.finalPrice, {
        when: ({ valueOf }) => this.isRuleManaged(valueOf(price.priceListUuid)),
      });
    });

    applyEach(path.attributes, (attribute) => {
      maxLength(attribute.rawValue, ATTRIBUTE_VALUE_MAX_LENGTH);
      validate(attribute.rawValue, ({ value, valueOf }) => {
        // Un atributo vacío simplemente no se envía, así que no hay nada que validar.
        const raw = value().trim();
        return raw ? attributeValueError(valueOf(attribute.type), raw) : null;
      });
    });
  });

  protected readonly saving = computed(() => this.productForm().submitting());

  /**
   * Si el producto participa del inventario. Con `NONE` la solapa Stock no existe: no hay saldo,
   * ni lotes, ni ajuste que mostrar, y una solapa vacía diría menos que ninguna.
   */
  protected readonly tracksStock = computed(
    () => this.productForm.stockTracking().value() !== 'NONE',
  );

  /**
   * Las filas de la composición tal como las dibuja la grilla. El `form()` expone los campos
   * editables —la cantidad—, pero el resto de la fila (nombre, saldo, precio) es dato resuelto que
   * no se edita: se lee del modelo, que es donde vive.
   */
  protected readonly kitRows = computed(() => this.model().kitItems);

  /** Un kit tiene composición; el resto del catálogo no. El bloque Componentes sólo existe ahí. */
  protected readonly isKitProduct = computed(() => isKit(this.productForm.productType().value()));

  protected readonly kitModes = KIT_MODES;

  /** El acceso directo del wireframe `1r`, con el producto ya elegido. */
  protected readonly newAssemblyPath = NEW_ASSEMBLY_PATH;

  /**
   * El kit armado: **es un producto**. Conserva sus solapas de stock, «disponible» se lee «podés
   * armar» y la composición pasa a ser la receta del armado en vez de lo que explota la venta.
   */
  protected readonly isAssembledKitProduct = computed(() =>
    isAssembledKit(this.productForm.productType().value(), this.productForm.kitMode().value()),
  );

  /**
   * Por qué no se puede volver a virtual, o `null` si se puede (RN-28).
   *
   * La regla es del backend y la valida él (`KIT_MODE_CHANGE_NOT_ALLOWED`); acá se anticipa con el
   * dato que la ficha ya tiene —el saldo del producto— para que la opción se vea **trabada con el
   * motivo a la vista** y no simplemente gris. Un radio deshabilitado sin explicación manda al
   * usuario a adivinar.
   */
  protected readonly virtualModeBlockedReason = computed(() => {
    if (!this.isAssembledKitProduct() || !this.productUuid) {
      return null;
    }
    const stock = this.loadedStock() ?? 0;
    return stock > 0 ? stock : null;
  });

  /**
   * El «costo estimado del terminado» del wireframe `1r`: lo que saldría armar uno hoy, con los
   * costos de la composición y sin adicionales.
   *
   * Es distinto de `cost`, que en un kit armado es el costo real **congelado** de lo que hay en el
   * estante (RN-24). Verlos juntos es lo que dice si la receta se encareció desde el último armado.
   */
  protected readonly kitCompositionCost = computed(() => {
    const rows = this.model().kitItems;
    if (rows.length === 0) {
      return null;
    }
    let total = 0;
    for (const row of rows) {
      if (row.componentCost === null || row.componentCost === undefined || row.quantity === null) {
        return null;
      }
      total += row.componentCost * row.quantity;
    }
    return roundPrice(total);
  });

  /**
   * `true` si el componente **no puede** formar parte de un kit armado: RN-27 —sólo se consume lo
   * que existe—. La fila se muestra igual, con el motivo, en vez de desaparecer del buscador sin
   * explicación (`ASSEMBLY_COMPONENT_REQUIRES_STOCK`).
   */
  protected isComponentUnusableInAssembly(row: ProductKitItemFormEntry): boolean {
    return this.isAssembledKitProduct() && !row.limitsAvailability;
  }

  /** Sin `product.kit_edit` la grilla se muestra pero no se edita ni viaja en el payload. */
  protected readonly canEditKit = this.auth.hasPermission(PRODUCT_KIT_EDIT_PERMISSION);

  /**
   * El disponible del kit: `mín ⌊stock(componente) / cantidad⌋` sobre los componentes que llevan
   * existencias (RN-07). `null` cuando no hay ninguno que limite —un combo de puros servicios— o
   * cuando falta un dato para calcularlo.
   *
   * Se calcula acá y no se espera al backend porque la grilla se edita antes de guardar: agregar un
   * componente tiene que mover el número en el acto, que es lo que hace entendible el mínimo.
   */
  protected readonly kitAvailability = computed(() => {
    let available: number | null = null;
    for (const row of this.model().kitItems) {
      const coverage = this.kitCoverage(row);
      if (coverage === null) {
        continue;
      }
      available = available === null ? coverage : Math.min(available, coverage);
    }
    return available;
  });

  /**
   * Precio del combo cuando lo declara la suma de sus partes: `Σ precio × cantidad`, menos el
   * descuento. `null` si algún componente todavía no tiene precio conocido, porque una suma
   * incompleta se leería como un precio real.
   */
  protected readonly kitComputedPrice = computed(() => {
    const rows = this.model().kitItems;
    if (rows.length === 0) {
      return null;
    }
    let total = 0;
    for (const row of rows) {
      if (row.listPrice === null || row.quantity === null) {
        return null;
      }
      total += row.listPrice * row.quantity;
    }
    const discount = this.model().kitDiscountPercent ?? 0;
    return roundPrice(total - (total * discount) / 100);
  });

  /** El eje de existencias está forzado por la naturaleza: un servicio o un kit no llevan stock. */
  protected readonly stockTrackingLocked = computed(() =>
    typeRequiresNoStock(
      this.productForm.productType().value(),
      this.productForm.kitMode().value(),
    ),
  );

  /** El vencimiento sólo tiene dónde vivir con partidas o series. */
  protected readonly expirationLocked = computed(
    () => !trackingSupportsExpiration(this.productForm.stockTracking().value()),
  );

  /**
   * Los modos de control que se ofrecen: lote y serie dependen de {@link FEATURES}, salvo el modo
   * con el que el producto ya está guardado, que se conserva para no dejar la selección vacía.
   */
  protected readonly stockTrackingModes = computed(() =>
    STOCK_TRACKING_MODES.filter((mode) => isStockTrackingOffered(mode, this.loadedStockTracking())),
  );

  /** Sin lote ni serie a la vista, el bloque de vencimiento no tiene qué decidir. */
  protected readonly expirationOffered = computed(
    () =>
      isExpirationOffered(this.loadedStockTracking()) ||
      trackingSupportsExpiration(this.productForm.stockTracking().value()),
  );

  /**
   * Alícuota con la que la grilla previsualiza el precio final. El campo vacío —inválido para el
   * submit— se muestra como 0 %, que deja el final igual al neto en vez de dejarlo en blanco.
   */
  protected readonly taxRate = computed(() => this.productForm.taxRate().value() ?? 0);

  constructor() {
    // La última miga de la edición es el producto en sí, así que muestra el título genérico
    // mientras el detalle está en vuelo y el nombre guardado apenas llega.
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.products', link: PRODUCTS_PATH },
      this.isEdit
        ? this.productName()
          ? { label: this.productName() }
          : { labelKey: 'products.form.editTitle' }
        : { labelKey: 'products.form.createTitle' },
    ]);
  }

  ngOnInit(): void {
    this.loadCatalogues();
  }

  protected onCancel(): void {
    void this.router.navigate([PRODUCTS_PATH]);
  }

  /**
   * Abre la evolución del precio del producto. Es una navegación como cualquier otra, así que con
   * cambios sin guardar el `unsavedChangesGuard` pregunta antes de salir.
   */
  protected onOpenPriceHistory(): void {
    if (this.productUuid) {
      void this.router.navigate([productPriceHistoryPath(this.productUuid)]);
    }
  }

  protected onRetry(): void {
    this.loadCatalogues();
  }

  protected onCategoryChange(categoryUuid: string | null): void {
    this.productForm.categoryUuid().value.set(categoryUuid);
    this.productForm.categoryUuid().markAsTouched();
    this.loadCategoryAttributes(categoryUuid);
  }

  protected onBrandChange(brandUuid: string | null): void {
    this.productForm.brandUuid().value.set(brandUuid);
  }

  protected onUnitMeasureChange(unitMeasure: string): void {
    this.productForm.unitMeasure().value.set(unitMeasure);
    this.productForm.unitMeasure().markAsTouched();
  }

  /**
   * Desmarcar el pesable borra el código de balanza: sin etiqueta que resolver, un código guardado
   * seguiría ocupando la unicidad de la empresa sin que nada lo use.
   */
  protected onWeighableChange(isWeighable: boolean): void {
    this.model.update((current) => ({
      ...current,
      isWeighable,
      scaleCode: isWeighable ? current.scaleCode : '',
    }));
    this.productForm.isWeighable().markAsTouched();
  }

  /**
   * La equivalencia de una fila, dicha con la unidad base del producto: «1 = 100 un».
   *
   * Es lo que evita que «factor 100» se lea como un segundo saldo (RN-16): el empaque no es una
   * existencia paralela, es cuántas unidades base entran en él. `null` mientras la fila no tenga un
   * factor usable, que es cuando no hay nada que decir.
   */
  protected packagingEquivalence(index: number): string | null {
    const factor = this.model().packagings[index]?.factor ?? null;
    if (factor === null || factor <= 0) {
      return null;
    }

    return this.translate.instant('products.form.packagings.equivalence', {
      factor,
      unit: this.translate.instant(`products.unitMeasures.${this.model().unitMeasure}`),
    });
  }

  /**
   * Elegir `SERVICE` o `KIT` apaga el bloque de stock: además de deshabilitarlo, el eje queda en
   * `NONE` en el modelo, que es lo único que el backend acepta para esa naturaleza (RN-01).
   */
  protected onTypeChange(type: ProductType): void {
    this.productForm.productType().value.set(type);
    this.productForm.productType().markAsTouched();
    if (typeRequiresNoStock(type, this.productForm.kitMode().value())) {
      this.onStockTrackingChange('NONE');
    }
  }

  /**
   * El modo del kit cambia el resto de la pantalla, y por eso el selector va arriba de todo.
   *
   * Al pasar a **virtual** el eje vuelve a `NONE` en el acto: el kit virtual no tiene saldo propio y
   * dejarlo en `BATCH` armaría un payload que el backend rechaza (`KIT_MODE_NOT_APPLICABLE`).
   * Al pasar a **armado** el eje se libera y arranca en `QUANTITY`, que es donde RN-28 lo deja: el
   * kit queda en cero hasta el primer armado.
   */
  protected onKitModeChange(mode: KitMode): void {
    this.productForm.kitMode().value.set(mode);
    this.productForm.kitMode().markAsTouched();
    if (mode === 'EXPLODE') {
      this.onStockTrackingChange('NONE');
      return;
    }
    if (this.productForm.stockTracking().value() === 'NONE') {
      this.onStockTrackingChange('QUANTITY');
    }
  }

  /** Sin partidas ni series el vencimiento vuelve a «no aplica»: no hay dónde guardarlo (RN-03). */
  protected onStockTrackingChange(stockTracking: StockTracking): void {
    this.productForm.stockTracking().value.set(stockTracking);
    this.productForm.stockTracking().markAsTouched();
    if (!trackingSupportsExpiration(stockTracking)) {
      this.productForm.expirationControl().value.set('NONE');
    }
  }

  protected onExpirationControlChange(expirationControl: ExpirationControl): void {
    this.productForm.expirationControl().value.set(expirationControl);
    this.productForm.expirationControl().markAsTouched();
  }

  /** La fila nueva nace como principal sólo cuando es la primera: si ya hay una, es alternativa. */
  protected onAddBarcode(): void {
    this.model.update((current) => ({
      ...current,
      barcodes: [...current.barcodes, { barcode: '', isPrimary: current.barcodes.length === 0 }],
    }));

    // La fila recién agregada no existe hasta el próximo render: recién ahí se le puede dar foco.
    afterNextRender(
      () => {
        const inputs = this.barcodeInputs();
        inputs[inputs.length - 1]?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  /** Quitar el principal promueve al primero que queda: el producto no se queda sin principal. */
  protected onRemoveBarcode(index: number): void {
    this.model.update((current) => {
      const barcodes = current.barcodes.filter((_, position) => position !== index);
      if (barcodes.length > 0 && !barcodes.some((entry) => entry.isPrimary)) {
        barcodes[0] = { ...barcodes[0], isPrimary: true };
      }
      return { ...current, barcodes };
    });
  }

  protected onAddPackaging(): void {
    this.model.update((current) => ({
      ...current,
      packagings: [
        ...current.packagings,
        { uuid: null, name: '', factor: null, isPurchaseDefault: false, isSaleDefault: false, barcode: '' },
      ],
    }));

    // Igual que en los códigos: el foco va a la fila nueva, que es donde se sigue escribiendo.
    afterNextRender(
      () => {
        const inputs = this.packagingInputs();
        inputs[inputs.length - 1]?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  /**
   * Para cuántos kits alcanza una fila: `⌊stock / cantidad⌋`. `null` cuando la fila no limita —el
   * componente no lleva stock— o cuando falta el dato con el que se calcularía.
   *
   * Es la columna «Alcanza para» del wireframe, y es lo que hace legible el mínimo: se ve **cuál
   * componente manda** sin hacer la cuenta.
   */
  protected kitCoverage(row: ProductKitItemFormEntry): number | null {
    if (!row.limitsAvailability || row.stock === null || row.quantity === null || row.quantity <= 0) {
      return null;
    }
    return Math.floor(row.stock / row.quantity);
  }

  /** La fila que marca el mínimo: la que hay que reponer para que haya más combos. */
  protected isKitBottleneck(row: ProductKitItemFormEntry): boolean {
    const available = this.kitAvailability();
    return available !== null && this.kitCoverage(row) === available;
  }

  /**
   * Agrega un componente al kit, elegido del selector de productos.
   *
   * Dos rechazos que se explican acá y no en el `400` del backend, porque acá se puede nombrar el
   * producto que se acaba de tocar: **un kit virtual no puede ser componente de nada** (RN-10) y
   * **un componente entra una sola vez**, con su cantidad.
   *
   * El kit **armado** sí entra, y en los dos modos (§6.10): consumirlo es consumir stock real, y es
   * la salida a la composición multinivel. Lo que no se rechaza acá es el componente sin
   * existencias dentro de un armado (RN-27): entra a la grilla y la fila se marca con el motivo
   * —{@link isComponentUnusableInAssembly}—, que dice más que un producto que desaparece del
   * buscador sin explicación.
   */
  protected onAddKitItem(): void {
    this.productPicker
      .pick({
        availability: 'sale',
        priceLists: this.priceLists().map((list) => ({ uuid: list.uuid, name: list.name })),
        title: this.translate.instant('products.form.kit.pickerTitle'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((product) => {
        if (!product) {
          return;
        }
        if (isVirtualKitPick(product)) {
          this.toast.error(
            this.translate.instant('products.form.kit.componentIsVirtualKit', {
              name: product.name,
            }),
          );
          return;
        }
        if (this.model().kitItems.some((row) => row.componentUuid === product.uuid)) {
          this.toast.error(
            this.translate.instant('products.form.kit.componentDuplicated', { name: product.name }),
          );
          return;
        }

        const tracksStock =
          product.tracksStock === true ||
          (product.tracksStock == null && product.stockTracking !== 'NONE');
        this.model.update((current) => ({
          ...current,
          kitItems: [
            ...current.kitItems,
            {
              uuid: null,
              componentUuid: product.uuid,
              componentName: product.name,
              componentSku: product.sku ?? null,
              quantity: 1,
              // El saldo que trae el selector es el de la sucursal activa, el mismo con el que el
              // backend deriva el disponible. `null` es «no lleva stock», no «no hay».
              stock: tracksStock ? (product.totalStock ?? 0) : null,
              listPrice: this.principalPriceOf(product),
              // El selector no trae el costo del componente: lo resuelve el backend en la
              // siguiente lectura. Queda en `null` —«todavía no se sabe»— y el costo estimado del
              // terminado se abstiene, en vez de mostrar una suma a la que le falta un sumando.
              componentCost: null,
              limitsAvailability: tracksStock,
            },
          ],
        }));
        this.productForm.kitItems().markAsTouched();
      });
  }

  protected onRemoveKitItem(index: number): void {
    this.model.update((current) => ({
      ...current,
      kitItems: current.kitItems.filter((_, position) => position !== index),
    }));
    this.productForm.kitItems().markAsTouched();
  }

  /**
   * Con qué precio pesa el componente en el prorrateo: el de la lista principal, que es la que
   * cotiza el catálogo cuando nadie eligió otra —y la misma con la que el backend enriquece la
   * composición—. `null` si esa lista no tiene el producto.
   */
  private principalPriceOf(product: PickerProduct): number | null {
    const principal = this.priceLists().find((list) => list.isPrincipal === true);
    if (!principal) {
      return null;
    }
    const entry = (product.priceListEntries ?? []).find(
      (row) => row.priceListUuid === principal.uuid,
    );
    return entry?.price ?? null;
  }

  protected onKitPricingChange(pricing: KitPricing): void {
    this.productForm.kitPricing().value.set(pricing);
    this.productForm.kitPricing().markAsTouched();
    if (pricing !== 'SUM_COMPONENTS') {
      this.productForm.kitDiscountPercent().value.set(null);
    }
  }

  protected onRemovePackaging(index: number): void {
    this.model.update((current) => ({
      ...current,
      packagings: current.packagings.filter((_, position) => position !== index),
    }));
  }

  /**
   * El default es exclusivo dentro de su operación: marcarlo en una fila lo desmarca en las demás,
   * que es más claro que dejar dos marcados y rechazar el guardado. Volver a marcar el que ya estaba
   * lo apaga: sin eso no habría forma de dejar al producto sin default.
   */
  protected onTogglePackagingDefault(index: number, operation: 'purchase' | 'sale'): void {
    this.model.update((current) => {
      const key = operation === 'purchase' ? 'isPurchaseDefault' : 'isSaleDefault';
      const wasSet = current.packagings[index]?.[key] === true;

      return {
        ...current,
        packagings: current.packagings.map((entry, position) => ({
          ...entry,
          [key]: position === index ? !wasSet : false,
        })),
      };
    });
    this.productForm.packagings().markAsTouched();
  }

  protected onSetPrimaryBarcode(index: number): void {
    this.model.update((current) => ({
      ...current,
      barcodes: current.barcodes.map((entry, position) => ({
        ...entry,
        isPrimary: position === index,
      })),
    }));
  }

  /**
   * Guardar con otro control de existencias reescribe cómo se lleva el inventario del producto:
   * antes de mandarlo, la pantalla explica la consecuencia y pide confirmación (RN-02). El backend
   * rechaza igual las transiciones que no puede hacer —con saldo, con más de una partida—, pero eso
   * llega después; acá se evita que el cambio salga sin que nadie lo haya querido.
   */
  private stockTrackingChanged(): boolean {
    return (
      this.isEdit &&
      this.loadedStockTracking() !== null &&
      this.loadedStockTracking() !== this.model().stockTracking
    );
  }

  private confirmStockTrackingChange(): Promise<boolean> {
    const next = this.model().stockTracking;
    const loaded = this.loadedStockTracking();
    if (loaded === null) {
      return Promise.resolve(true);
    }

    return firstValueFrom(
      this.confirm.confirm({
        title: this.translate.instant('products.form.stockTrackingChange.title'),
        message: this.translate.instant('products.form.stockTrackingChange.message', {
          from: this.translate.instant(`products.stockTrackingModes.${loaded}`),
          to: this.translate.instant(`products.stockTrackingModes.${next}`),
        }),
        confirmLabel: this.translate.instant('products.form.stockTrackingChange.confirm'),
        cancelLabel: this.translate.instant('products.form.stockTrackingChange.cancel'),
        confirmColor: 'primary',
      }),
    );
  }

  protected onForSaleChange(checked: boolean): void {
    this.productForm.isForSale().value.set(checked);
  }

  protected onForPurchaseChange(checked: boolean): void {
    this.productForm.isForPurchase().value.set(checked);
  }

  protected onAttributeBooleanChange(index: number, checked: boolean): void {
    this.model.update((current) => ({
      ...current,
      attributes: current.attributes.map((attribute, position) =>
        position === index ? { ...attribute, rawValue: String(checked) } : attribute,
      ),
    }));
  }

  protected isBranchSelected(branchUuid: string): boolean {
    return this.productForm.branchUuids().value().includes(branchUuid);
  }

  protected onBranchToggle(branchUuid: string, checked: boolean): void {
    const field = this.productForm.branchUuids();
    const selected = field.value();

    field.value.set(
      checked ? [...selected, branchUuid] : selected.filter((uuid) => uuid !== branchUuid),
    );
  }

  protected onToggleAllBranches(checked: boolean): void {
    this.productForm
      .branchUuids()
      .value.set(checked ? this.branches().map((branch) => branch.uuid) : []);
  }

  protected readonly allBranchesSelected = computed(() => {
    const available = this.branches();
    return (
      available.length > 0 && available.length === this.productForm.branchUuids().value().length
    );
  });

  protected readonly someBranchesSelected = computed(() => {
    const selected = this.productForm.branchUuids().value().length;
    return selected > 0 && selected < this.branches().length;
  });

  /**
   * Proveedores vinculados, en el orden en que se agregaron. El nombre sale de las opciones y, si
   * no está entre ellas, del detalle del producto; el uuid sólo queda a la vista cuando no hay
   * ninguno de los dos, que es un vínculo a algo que esta pantalla no puede nombrar.
   */
  protected readonly selectedSuppliers = computed<readonly UuidNameRef[]>(() => {
    const byUuid = new Map(this.suppliers().map((supplier) => [supplier.uuid, supplier.name]));
    const linked = this.linkedSupplierNames();

    return this.productForm
      .supplierUuids()
      .value()
      .map((uuid) => ({ uuid, name: byUuid.get(uuid) ?? linked.get(uuid) ?? uuid }));
  });

  /**
   * Opciones del autocompletado: las que todavía no están elegidas y coinciden con lo tipeado. Sin
   * texto ofrece las primeras, así el campo también sirve para ver qué hay sin saber qué buscar.
   */
  protected readonly supplierSuggestions = computed<readonly UuidNameRef[]>(() => {
    const term = this.supplierSearch().trim().toLowerCase();
    const selected = new Set(this.productForm.supplierUuids().value());

    return this.suppliers()
      .filter(
        (supplier) =>
          !selected.has(supplier.uuid) &&
          (term.length === 0 || supplier.name.toLowerCase().includes(term)),
      )
      .slice(0, SUPPLIER_SUGGESTIONS_LIMIT);
  });

  protected onSupplierSearchInput(event: Event): void {
    this.supplierSearch.set((event.target as HTMLInputElement).value);
  }

  protected onSupplierSelected(supplier: UuidNameRef): void {
    const field = this.productForm.supplierUuids();

    if (!field.value().includes(supplier.uuid)) {
      field.value.set([...field.value(), supplier.uuid]);
    }

    // El campo se vacía: ya está elegido, y lo que sigue es buscar el próximo.
    this.supplierSearch.set('');
  }

  protected onRemoveSupplier(supplierUuid: string): void {
    const field = this.productForm.supplierUuids();
    field.value.set(field.value().filter((uuid) => uuid !== supplierUuid));
  }

  protected priceListName(priceListUuid: string): string {
    return this.priceListsByUuid().get(priceListUuid)?.name ?? priceListUuid;
  }

  protected isPrincipalPriceList(priceListUuid: string): boolean {
    return this.priceListsByUuid().get(priceListUuid)?.isPrincipal === true;
  }

  /** La regla recalcula esta lista en la sucursal activa, así que su precio no se edita a mano. */
  protected isRuleManaged(priceListUuid: string): boolean {
    return this.rulePercentByPriceList().has(priceListUuid);
  }

  /** Porcentaje con el que la regla recalcula la lista; `null` sólo si la regla no la alcanza. */
  protected rulePercent(priceListUuid: string): number | null {
    return this.rulePercentByPriceList().get(priceListUuid) ?? null;
  }

  /**
   * Cada punta del precio recalcula la otra sobre lo que se acaba de tipear, leído del propio input
   * en vez del modelo: `[formField]` ya escribe el campo editado, y así el handler no depende de si
   * corre antes o después de él. La punta que el usuario no está tocando es la única que se toca.
   */
  protected onBasePriceInput(index: number, event: Event): void {
    const price = readPriceInput(event);
    this.updatePriceEntry(index, (entry) => ({
      ...entry,
      finalPrice: addTax(price, this.taxRate()),
    }));
  }

  protected onFinalPriceInput(index: number, event: Event): void {
    const finalPrice = readPriceInput(event);
    this.updatePriceEntry(index, (entry) => ({
      ...entry,
      price: removeTax(finalPrice, this.taxRate()),
    }));
  }

  /**
   * Cambiar la alícuota mueve todos los precios finales: el neto es el que está guardado, así que es
   * el que manda. Se lee del input por lo mismo que los precios: el `[formField]` puede no haber
   * escrito el modelo todavía.
   */
  protected onTaxRateInput(event: Event): void {
    const taxRate = readPriceInput(event) ?? 0;

    this.model.update((current) => ({
      ...current,
      prices: current.prices.map((entry) => ({
        ...entry,
        finalPrice: addTax(entry.price, taxRate),
      })),
    }));
  }

  private updatePriceEntry(
    index: number,
    update: (entry: ProductPriceFormEntry) => ProductPriceFormEntry,
  ): void {
    this.model.update((current) => ({
      ...current,
      prices: current.prices.map((entry, position) => (position === index ? update(entry) : entry)),
    }));
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    // El archivado no tiene botón de guardar, pero el `<form>` también se envía con Enter: el
    // backend responde `400 PRODUCT_ARCHIVED_READ_ONLY` y no hay nada que ganar en preguntárselo.
    if (this.archived()) {
      return;
    }

    if (this.productForm().invalid()) {
      this.productForm().markAsTouched();
      this.selectedTab.set(this.firstInvalidTab());
      return;
    }

    void submit(this.productForm, async () => {
      // Sólo se espera al diálogo cuando hay algo que confirmar: el guardado común sigue saliendo
      // en el mismo tick, sin un salto de microtarea que nadie pidió.
      if (this.stockTrackingChanged() && !(await this.confirmStockTrackingChange())) {
        return undefined;
      }

      try {
        const outcome = await firstValueFrom(
          this.versionConflict.saveGuarded<ProductDto, ProductDto>({
            uuid: this.productUuid ?? undefined,
            version: this.productVersion,
            // El payload se rearma en cada intento en vez de reusar uno: el interceptor de auth
            // puede reenviar el request original después de refrescar el token, y mutar el objeto
            // compartido le cambiaría la versión a ese reenvío.
            save: (version) => this.productsApi.save(this.buildPayload(version)),
            fetchLatest: (uuid) => this.productsApi.getByUuid(uuid),
            label: this.model().name.trim(),
            // Acá el formulario sigue en pantalla detrás del diálogo, así que cancelar es una
            // salida honesta: deja lo editado intacto para decidir más tarde.
            allowCancel: true,
          }),
        );

        // El conflicto llega como valor y no como excepción: sin mirar `kind` se daría por guardado
        // algo que el usuario canceló, o que se recargó descartando lo que había editado.
        if (outcome.kind === 'cancelled') {
          // Lo editado sigue siendo trabajo real sin guardar, así que no se renueva la foto. No
          // hace falta avisar: o lo decidió el usuario, o falló la recarga y el servicio ya lo dijo.
          return undefined;
        }

        if (outcome.kind === 'reloaded') {
          // Se vuelca encima el producto que hoy tiene el servidor, con las listas de precio que ya
          // están en pantalla: son catálogo de la empresa y no cambiaron con este conflicto.
          this.hydrate(outcome.latest, this.priceLists());
          // El usuario ya aceptó descartar lo suyo: sin renovar la foto el guard le frenaría la
          // próxima navegación por cambios que él mismo decidió tirar. `hydrate()` vuelve a
          // capturar cuando aterrizan los atributos de la categoría; esto cierra la ventana hasta
          // entonces.
          this.changes.capture();
          this.toast.info(this.translate.instant('versionConflict.reloaded'));
          return undefined;
        }

        this.toast.success(
          this.translate.instant(
            this.isEdit ? 'products.toasts.updated' : 'products.toasts.created',
            {
              name: outcome.value.name,
            },
          ),
        );
        // La respuesta trae la versión ya incrementada: si al editar la navegación no llegara a
        // ocurrir, el próximo guardado saldría con la vigente en vez de chocar contra sí mismo.
        this.productVersion = outcome.value.version;
        // Lo cargado ya está persistido: sin renovar la foto, el guard frenaría esta misma
        // navegación. Si el guardado falla la foto queda como estaba y la salida vuelve a preguntar.
        this.changes.capture();
        await this.router.navigate([PRODUCTS_PATH]);
      } catch (error) {
        // El mensaje del backend es lo único que dice qué hay que cambiar —de qué producto es el
        // SKU que choca, por ejemplo—, así que se muestra tal cual y el texto propio queda de
        // fallback para las fallas que no traen cuerpo (red caída, 500 sin body).
        this.toast.error(
          resolveApiErrorMessage(error, this.translate.instant('products.toasts.saveError')),
        );

        // El SKU repetido es el único error del guardado que apunta a un campo concreto de la
        // pantalla. Marcarlo ahí y saltar a su solapa evita que el usuario tenga que adivinar
        // cuál de las tres tiene el problema; el resto se queda sólo en el toast porque no hay
        // un campo al que culpar.
        if (hasApiErrorCode(error, API_ERROR_CODES.PRODUCT_SKU_DUPLICATE)) {
          this.selectedTab.set(TAB_GENERAL);
          this.productForm.sku().markAsTouched();
          return { kind: 'skuDuplicate', fieldTree: this.productForm.sku };
        }

        // Mismo criterio para el código de barras repetido y para los ejes: el backend dice qué
        // fila o qué eje rechazó, y la pantalla lo marca ahí en vez de dejarlo sólo en el toast.
        if (hasApiErrorCode(error, API_ERROR_CODES.DUPLICATE_PRODUCT_BARCODE)) {
          this.selectedTab.set(TAB_GENERAL);
          this.productForm.barcodes().markAsTouched();
          return { kind: 'barcodeDuplicate', fieldTree: this.productForm.barcodes };
        }

        // El pesable con unidad entera no vuelve como error de servidor: se anota la unidad que el
        // backend rechazó y la validación del esquema la marca desde ahí. Así el mensaje se va solo
        // en cuanto el usuario cambia la unidad —o desmarca el pesable—, que es lo que un error de
        // servidor pegado a `isWeighable` no hacía.
        if (hasApiErrorCode(error, API_ERROR_CODES.WEIGHABLE_REQUIRES_FRACTIONAL_UNIT)) {
          const rejected = readApiErrorData(error)?.['unitMeasure'];
          if (typeof rejected === 'string') {
            this.unitsRejectedForWeighable.update((units) => new Set(units).add(rejected));
          }
          this.selectedTab.set(TAB_GENERAL);
          this.productForm.isWeighable().markAsTouched();
          return undefined;
        }

        if (hasApiErrorCode(error, API_ERROR_CODES.DUPLICATE_SCALE_CODE)) {
          this.selectedTab.set(TAB_GENERAL);
          this.productForm.scaleCode().markAsTouched();
          return { kind: 'scaleCodeDuplicate', fieldTree: this.productForm.scaleCode };
        }

        // Los tres de la grilla de empaques van a su propia solapa, que es donde está la fila.
        if (
          hasApiErrorCode(error, API_ERROR_CODES.PACKAGING_FACTOR_INVALID) ||
          hasApiErrorCode(error, API_ERROR_CODES.PACKAGING_DEFAULT_DUPLICATED) ||
          hasApiErrorCode(error, API_ERROR_CODES.PACKAGING_NAME_REQUIRED)
        ) {
          this.selectedTab.set(TAB_PACKAGINGS);
          this.productForm.packagings().markAsTouched();
          return { kind: 'packagingRejected', fieldTree: this.productForm.packagings };
        }

        // Los de la composición van a General, que es donde vive la grilla con la fila que hay que
        // corregir —igual que `KIT_ITEMS_NOT_APPLICABLE`, cuyo problema es la naturaleza del
        // producto, elegida en la misma solapa.
        if (hasApiErrorCode(error, API_ERROR_CODES.KIT_ITEMS_NOT_APPLICABLE)) {
          this.selectedTab.set(TAB_GENERAL);
          this.productForm.productType().markAsTouched();
          return undefined;
        }

        if (
          hasApiErrorCode(error, API_ERROR_CODES.KIT_REQUIRES_COMPONENTS) ||
          hasApiErrorCode(error, API_ERROR_CODES.KIT_COMPONENT_NOT_FOUND) ||
          hasApiErrorCode(error, API_ERROR_CODES.KIT_COMPONENT_DUPLICATED) ||
          hasApiErrorCode(error, API_ERROR_CODES.KIT_COMPONENT_QUANTITY_INVALID) ||
          hasApiErrorCode(error, API_ERROR_CODES.KIT_COMPONENT_CANNOT_BE_VIRTUAL_KIT) ||
          hasApiErrorCode(error, API_ERROR_CODES.KIT_COMPONENT_NOT_SELLABLE)
        ) {
          this.selectedTab.set(TAB_GENERAL);
          this.productForm.kitItems().markAsTouched();
          return { kind: 'kitRejected', fieldTree: this.productForm.kitItems };
        }

        if (hasApiErrorCode(error, API_ERROR_CODES.KIT_DISCOUNT_PERCENT_INVALID)) {
          this.selectedTab.set(TAB_PRICING);
          this.productForm.kitDiscountPercent().markAsTouched();
          return { kind: 'kitRejected', fieldTree: this.productForm.kitDiscountPercent };
        }

        if (
          hasApiErrorCode(error, API_ERROR_CODES.PRODUCT_STOCK_TRACKING_CHANGE_NOT_ALLOWED) ||
          hasApiErrorCode(error, API_ERROR_CODES.PRODUCT_TYPE_REQUIRES_NO_STOCK) ||
          hasApiErrorCode(error, API_ERROR_CODES.EXPIRATION_REQUIRES_BATCH)
        ) {
          this.selectedTab.set(TAB_GENERAL);
          this.productForm.stockTracking().markAsTouched();
          return { kind: 'stockTrackingRejected', fieldTree: this.productForm.stockTracking };
        }
      }

      return undefined;
    });
  }

  /** Solapa a la que saltar cuando el submit falla: la primera que tenga algún campo inválido. */
  private firstInvalidTab(): number {
    const generalInvalid =
      this.productForm.name().invalid() ||
      this.productForm.sku().invalid() ||
      this.productForm.barcodes().invalid() ||
      this.productForm.categoryUuid().invalid() ||
      this.productForm.brandUuid().invalid() ||
      this.productForm.unitMeasure().invalid() ||
      this.productForm.taxRate().invalid() ||
      this.productForm.lowStock().invalid() ||
      this.productForm.optimalStock().invalid() ||
      this.productForm.productType().invalid() ||
      this.productForm.stockTracking().invalid() ||
      this.productForm.expirationControl().invalid() ||
      this.productForm.expirationAlertDays().invalid() ||
      this.productForm.standardCost().invalid() ||
      this.productForm.isWeighable().invalid() ||
      this.productForm.scaleCode().invalid() ||
      this.productForm.attributes().invalid() ||
      // La composición vive en General, junto a los ejes que la habilitan: un error acá —una
      // cantidad en cero, un kit sin componentes— manda a la misma solapa que el resto.
      (this.isKitProduct() && this.productForm.kitItems().invalid());

    if (generalInvalid) {
      return TAB_GENERAL;
    }

    if (this.productForm.prices().invalid() || this.productForm.kitDiscountPercent().invalid()) {
      return TAB_PRICING;
    }

    return this.productForm.packagings().invalid() ? TAB_PACKAGINGS : TAB_INVENTORY;
  }

  private buildPayload(version: number | undefined): ProductSavePayload {
    const value = this.model();

    const payload: ProductSavePayload = {
      // El `uuid` es lo único que convierte el alta en edición para el backend, y la versión sólo
      // acompaña a ese caso: sin `uuid` no hay registro previo contra el cual validarla.
      ...(this.productUuid ? { uuid: this.productUuid, version } : {}),
      name: value.name.trim(),
      sku: emptyToNull(value.sku),
      // La grilla entera, recortada: es la verdad para el backend, que agrega, quita y marca el
      // principal a partir de ella. Una lista vacía deja al producto sin código.
      barcodes: value.barcodes.map((entry) => ({
        barcode: entry.barcode.trim(),
        isPrimary: entry.isPrimary,
      })),
      // Igual que los códigos: la grilla entera es la verdad. Cada fila reenvía su `uuid` cuando ya
      // existía —es lo que la conserva al renombrarla— y el código vacío viaja en `null`.
      packagings: value.packagings.map((entry) => ({
        ...(entry.uuid ? { uuid: entry.uuid } : {}),
        name: entry.name.trim(),
        factor: entry.factor ?? 0,
        isPurchaseDefault: entry.isPurchaseDefault,
        isSaleDefault: entry.isSaleDefault,
        barcode: emptyToNull(entry.barcode),
      })),
      unitMeasure: value.unitMeasure,
      taxRate: value.taxRate ?? DEFAULT_TAX_RATE,
      lowStock: value.lowStock,
      optimalStock: value.optimalStock,
      type: value.productType,
      stockTracking: value.stockTracking,
      expirationControl: value.expirationControl,
      expirationAlertDays: value.expirationAlertDays,
      standardCost: value.standardCost,
      isWeighable: value.isWeighable,
      // Sin pesable no hay etiqueta que resolver: el código no viaja, y desmarcar el check lo borra.
      scaleCode: value.isWeighable ? emptyToNull(value.scaleCode) : null,
      isForSale: value.isForSale,
      isForPurchase: value.isForPurchase,
      brand: value.brandUuid ? { uuid: value.brandUuid } : null,
      category: value.categoryUuid ? { uuid: value.categoryUuid } : null,
    };

    // La composición sólo viaja en un kit y con permiso: en otro producto el backend responde
    // `KIT_ITEMS_NOT_APPLICABLE`, y sin `product.kit_edit` responde 403. Omitirla deja la grilla
    // intacta del otro lado, que es exactamente lo que corresponde cuando no se pudo editar.
    if (isKit(value.productType)) {
      payload.kitPricing = value.kitPricing;
      payload.kitMode = value.kitMode;
      payload.kitDiscountPercent =
        value.kitPricing === 'SUM_COMPONENTS' ? value.kitDiscountPercent : null;
      if (this.canEditKit) {
        payload.kitItems = value.kitItems.map((entry, position) => ({
          ...(entry.uuid ? { uuid: entry.uuid } : {}),
          component: { uuid: entry.componentUuid },
          quantity: entry.quantity ?? 0,
          // El orden de la grilla es el orden en el que se listan: el que se ve es el que se guarda.
          displayOrder: position,
        })) satisfies ProductKitItemPayload[];
      }
    }

    // Un atributo sin valor se omite: el backend rechaza los valores nulos o vacíos.
    const categoryAttributes = value.attributes
      .map((attribute) => ({
        attributeUuid: attribute.attributeUuid,
        value: attribute.rawValue.trim(),
      }))
      .filter((attribute) => attribute.value.length > 0);
    if (categoryAttributes.length > 0) {
      payload.categoryAttributes = categoryAttributes;
    }

    // Las listas sin precio no viajan: mandarlas en 0 sería fijar un precio, no dejarlas sin uno.
    // Las que maneja la regla tampoco: reenviar el precio que la pantalla mostró lo persistiría
    // como manual y pisaría el que la regla haya recalculado mientras el formulario estaba abierto.
    // Sólo viaja el neto: el precio final es una previsualización que el backend rearma al vender.
    const priceListEntries = value.prices
      .filter((entry) => entry.price !== null && !this.isRuleManaged(entry.priceListUuid))
      .map((entry) => ({ priceListUuid: entry.priceListUuid, price: entry.price }));
    if (priceListEntries.length > 0) {
      payload.priceListEntries = priceListEntries;
    }

    if (this.canAssignBranches) {
      payload.branches = [...value.branchUuids, ...this.hiddenBranchUuids].map((uuid) => ({
        uuid,
      }));
    }

    // Sin `supplier.view` la sección es de sólo lectura y el campo se omite: mandar la lista que la
    // pantalla no pudo editar sería reenviarla igual, pero sin nada que lo garantice.
    if (this.canViewSuppliers) {
      payload.suppliers = value.supplierUuids.map((uuid) => ({ uuid }));
    }

    return payload;
  }

  /**
   * Marcas, categorías, listas de precio y sucursales pueblan los selects y las grillas. Cada una
   * falla por separado —un error deja ese select vacío, no la pantalla— para que el alta siga
   * siendo posible con lo que sí cargó.
   *
   * El detalle del producto es la excepción: en la edición no hay nada que mostrar sin él, así que
   * su error deja la pantalla en estado de error con reintento en vez de abrir un formulario vacío
   * que pisaría el producto al guardar.
   */
  private loadCatalogues(): void {
    this.loadState.set(LoadState.Loading);

    forkJoin({
      brands: this.productsApi.getBrands().pipe(
        catchError(() => {
          this.toast.error(this.translate.instant('products.toasts.brandsError'));
          return of([] as UuidNameRef[]);
        }),
      ),
      categories: this.productsApi.getCategoryOptions().pipe(
        catchError(() => {
          this.toast.error(this.translate.instant('products.toasts.categoriesError'));
          return of([] as CategoryOption[]);
        }),
      ),
      priceLists: this.productsApi.getPriceLists().pipe(
        catchError(() => {
          this.toast.error(this.translate.instant('products.toasts.priceListsError'));
          return of([] as PriceListDto[]);
        }),
      ),
      branches: this.canAssignBranches
        ? this.branchesApi.listAll().pipe(
            catchError(() => {
              this.toast.error(this.translate.instant('products.toasts.branchesError'));
              return of([] as BranchDto[]);
            }),
          )
        : of([] as BranchDto[]),
      suppliers: this.canViewSuppliers
        ? this.productsApi.getSuppliers().pipe(
            catchError(() => {
              this.toast.error(this.translate.instant('products.toasts.suppliersError'));
              return of([] as UuidNameRef[]);
            }),
          )
        : of([] as UuidNameRef[]),
      product: this.productUuid ? this.productsApi.getByUuid(this.productUuid) : of(null),
      // Falla abierto: sin la regla la grilla queda editable, que es como se comportaba la pantalla
      // antes de consultarla. El backend sigue recalculando esos precios de todos modos.
      priceRule:
        this.productUuid && this.canViewPriceRules
          ? this.productsApi.getPriceRule(this.productUuid).pipe(
              catchError(() => {
                this.toast.error(this.translate.instant('products.toasts.priceRuleError'));
                return of(null);
              }),
            )
          : of(null),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.brands.set(data.brands);
          this.categories.set(data.categories);
          this.priceLists.set(data.priceLists);
          this.branches.set(data.branches.filter((branch) => branch.active !== false));
          this.suppliers.set(data.suppliers);
          this.priceRule.set(data.priceRule);

          if (data.product) {
            this.hydrate(data.product, data.priceLists);
          } else {
            this.model.update((current) => ({
              ...current,
              prices: data.priceLists.map((list) => ({
                priceListUuid: list.uuid,
                price: null,
                finalPrice: null,
              })),
              // Un producto nuevo se ofrece en toda la empresa salvo que se diga lo contrario:
              // desmarcar las pocas sucursales que no lo venden es menos trabajo que marcar todas.
              // En la edición no aplica: ahí las sucursales vinculadas las manda el producto.
              branchUuids: this.branches().map((branch) => branch.uuid),
            }));
            // En el alta no hay atributos en vuelo —todavía no hay categoría elegida—, así que el
            // formulario vacío ya es la línea de base. La edición la toma al final de `hydrate()`.
            this.changes.capture();
          }

          this.loadState.set(LoadState.Success);
        },
        error: () => {
          this.loadState.set(LoadState.Error);
        },
      });
  }

  /**
   * Vuelca el producto guardado en el formulario. La grilla de precios se arma siempre desde las
   * listas activas —no desde lo que el producto tenga cargado—, así que una lista nueva aparece
   * vacía y una lista sin precio sigue sin precio.
   */
  private hydrate(product: ProductDto, priceLists: readonly PriceListDto[]): void {
    this.archived.set(isArchivedProduct(product));
    this.productName.set(product.name);
    this.productModel.set(product.model ?? null);
    this.unitDecimalPlaces.set(product.unitDecimalPlaces ?? null);
    // La versión sale siempre de la lectura que llena el formulario, sea la de la carga inicial o
    // la de una recarga por conflicto: es contra esa foto que el usuario edita.
    this.productVersion = product.version;
    this.cost.set(product.cost ?? null);
    this.costMethod.set(product.costMethod ?? null);
    this.loadedStock.set(product.totalStock ?? null);

    const priceByListUuid = new Map(
      (product.priceListEntries ?? []).map((entry) => [entry.priceListUuid, entry.price ?? null]),
    );
    // La alícuota del producto, no la que el modelo tenga todavía: es la misma escritura.
    const taxRate = product.taxRate ?? DEFAULT_TAX_RATE;
    const linkedBranchUuids = (product.branches ?? []).map((branch) => branch.uuid);
    const visibleBranchUuids = new Set(this.branches().map((branch) => branch.uuid));

    this.hiddenBranchUuids = linkedBranchUuids.filter((uuid) => !visibleBranchUuids.has(uuid));

    const linkedSuppliers = product.suppliers ?? [];
    this.linkedSupplierNames.set(
      new Map(linkedSuppliers.map((supplier) => [supplier.uuid, supplier.name])),
    );

    const stockTracking = toStockTracking(product.stockTracking);
    this.loadedStockTracking.set(stockTracking);
    // `?tab=stock` no tiene adónde ir en un producto que no lleva stock: la solapa no existe.
    if (stockTracking === 'NONE' && this.selectedTab() === TAB_STOCK) {
      this.selectedTab.set(TAB_GENERAL);
    }

    this.model.update((current) => ({
      ...current,
      name: product.name ?? '',
      sku: product.sku ?? '',
      barcodes: toBarcodeEntries(product),
      packagings: toPackagingEntries(product),
      kitItems: toKitItemEntries(product),
      kitPricing: toKitPricing(product.kitPricing),
      kitMode: toKitMode(product.kitMode),
      kitDiscountPercent: product.kitDiscountPercent ?? null,
      categoryUuid: product.category?.uuid ?? null,
      brandUuid: product.brand?.uuid ?? null,
      unitMeasure: product.unitMeasure ?? DEFAULT_UNIT_MEASURE,
      taxRate,
      lowStock: product.lowStock ?? null,
      optimalStock: product.optimalStock ?? null,
      productType: toProductType(product.type),
      stockTracking,
      expirationControl: toExpirationControl(product.expirationControl),
      expirationAlertDays: product.expirationAlertDays ?? null,
      standardCost: product.standardCost ?? null,
      isWeighable: product.isWeighable === true,
      scaleCode: product.scaleCode ?? '',
      isForSale: product.isForSale ?? true,
      isForPurchase: product.isForPurchase ?? true,
      prices: priceLists.map((list) => {
        const price = priceByListUuid.get(list.uuid) ?? null;
        return { priceListUuid: list.uuid, price, finalPrice: addTax(price, taxRate) };
      }),
      branchUuids: linkedBranchUuids.filter((uuid) => visibleBranchUuids.has(uuid)),
      // Todos, estén o no entre las opciones: el chip se dibuja con el nombre que trajo el detalle
      // y así guardar no desvincula al proveedor que la pantalla no llegó a listar.
      supplierUuids: linkedSuppliers.map((supplier) => supplier.uuid),
    }));

    const savedAttributeValues = new Map(
      (product.categoryAttributes ?? []).map((attribute) => [
        attribute.attributeUuid,
        attribute.value,
      ]),
    );
    this.loadCategoryAttributes(product.category?.uuid ?? null, savedAttributeValues);
  }

  /**
   * Los atributos de una categoría incluyen los heredados de sus ancestros y son los únicos que el
   * backend acepta, así que la grilla se rearma en cada cambio de categoría. Los valores ya
   * tipeados se conservan cuando el atributo sigue vigente en la categoría nueva.
   *
   * `savedValues` son los del producto que se está editando: mandan sobre lo tipeado porque en la
   * hidratación no hay nada tipeado todavía. Que estén presentes es además lo que distingue la
   * hidratación de un cambio de categoría del usuario, y por eso es acá —recién cuando los
   * atributos aterrizan— donde la edición toma su línea de base para el guard de salida.
   */
  private loadCategoryAttributes(
    categoryUuid: string | null,
    savedValues?: ReadonlyMap<string, string>,
  ): void {
    const isHydration = savedValues !== undefined;

    if (!categoryUuid) {
      this.attributesLoading.set(false);
      this.model.update((current) => ({ ...current, attributes: [] }));
      if (isHydration) {
        this.changes.capture();
      }
      return;
    }

    this.attributesLoading.set(true);

    this.productsApi
      .getCategoryAttributes(categoryUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (attributes) => {
          this.model.update((current) => ({
            ...current,
            attributes: toAttributeEntries(attributes, current.attributes, savedValues),
          }));
          this.attributesLoading.set(false);
          if (isHydration) {
            this.changes.capture();
          }
        },
        error: () => {
          this.model.update((current) => ({ ...current, attributes: [] }));
          this.attributesLoading.set(false);
          this.toast.error(this.translate.instant('products.toasts.attributesError'));
          if (isHydration) {
            this.changes.capture();
          }
        },
      });
  }
}

/** Rearma la grilla de atributos conservando lo ya tipeado para los que siguen existiendo. */
function toAttributeEntries(
  attributes: readonly CategoryAttributeDto[],
  current: readonly ProductAttributeFormEntry[],
  savedValues?: ReadonlyMap<string, string>,
): ProductAttributeFormEntry[] {
  const typedByUuid = new Map(current.map((entry) => [entry.attributeUuid, entry.rawValue]));

  return attributes.map((attribute) => ({
    attributeUuid: attribute.uuid,
    name: attribute.name,
    type: attribute.type,
    rawValue:
      savedValues?.get(attribute.uuid) ??
      typedByUuid.get(attribute.uuid) ??
      (attribute.type === 'boolean' ? 'false' : ''),
  }));
}

/**
 * Misma validación que `CategoryAttributeValueValidator` del backend, para no descubrir el formato
 * incorrecto recién en la respuesta. Un tipo desconocido se trata como texto libre.
 */
function attributeValueError(type: string, raw: string): ValidationError | null {
  switch (type) {
    case 'number':
      return /^-?\d+$/.test(raw) ? null : { kind: 'attributeNumber' };
    case 'decimal':
      return Number.isFinite(Number(raw)) ? null : { kind: 'attributeDecimal' };
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? null : { kind: 'attributeDate' };
    default:
      return null;
  }
}

/**
 * La grilla de códigos del producto guardado, el principal primero. Un producto anterior a la
 * grilla —que sólo trae el campo único— se muestra con esa única fila como principal.
 */
function toBarcodeEntries(product: ProductDto): ProductBarcodeFormEntry[] {
  const rows = product.barcodes ?? [];
  if (rows.length === 0) {
    const legacy = product.barcode?.trim() ?? '';
    return legacy ? [{ barcode: legacy, isPrimary: true }] : [];
  }

  const entries = rows.map((row) => ({
    barcode: row.barcode ?? '',
    isPrimary: row.isPrimary === true,
  }));
  if (!entries.some((entry) => entry.isPrimary)) {
    entries[0] = { ...entries[0], isPrimary: true };
  }
  return entries;
}

/** La grilla de empaques del producto guardado, con el `uuid` de cada fila para poder conservarla. */
/**
 * La composición tal como la devuelve el backend, ya enriquecida: cada fila viene con el saldo del
 * componente y para cuántos kits alcanza, así que la grilla se dibuja sin pedir nada más.
 */
function toKitItemEntries(product: ProductDto): ProductKitItemFormEntry[] {
  return (product.kitItems ?? []).map((row) => ({
    uuid: row.uuid ?? null,
    componentUuid: row.component.uuid,
    componentName: row.component.name,
    componentSku: row.componentSku ?? null,
    quantity: row.quantity ?? null,
    stock: row.stock ?? null,
    listPrice: row.listPrice ?? null,
    componentCost: row.componentCost ?? null,
    // El componente sin control de existencias no limita: es lo único que distingue «no lleva
    // stock» de «no hay stock» (RN-07).
    limitsAvailability: row.limitsAvailability === true,
  }));
}

function toPackagingEntries(product: ProductDto): ProductPackagingFormEntry[] {
  return (product.packagings ?? []).map((row) => ({
    uuid: row.uuid ?? null,
    name: row.name ?? '',
    factor: row.factor ?? null,
    isPurchaseDefault: row.isPurchaseDefault === true,
    isSaleDefault: row.isSaleDefault === true,
    barcode: row.barcode ?? '',
  }));
}

/** Como lo compara el backend: recortado y sin distinguir mayúsculas. */
function normalizeBarcode(value: string): string {
  return value.trim().toUpperCase();
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Lo tipeado en un input numérico. Un `type="number"` entrega `''` tanto vacío como con un texto que
 * no llegó a ser número, y las dos cosas son lo mismo para la grilla: todavía no hay precio.
 */
function readPriceInput(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (raw.length === 0) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Precio final = neto + impuesto, el mismo cálculo que la línea de venta del backend. */
function addTax(price: number | null, taxRate: number): number | null {
  return price === null ? null : roundPrice(price * (1 + taxRate / 100));
}

/** La vuelta: el neto que hay que guardar para que el precio final sea el que se tipeó. */
function removeTax(finalPrice: number | null, taxRate: number): number | null {
  return finalPrice === null ? null : roundPrice(finalPrice / (1 + taxRate / 100));
}

/**
 * Redondeo de la previsualización. El de la venta lo aplica la sucursal con su propio modo
 * (`PriceRoundingService`), que la pantalla no conoce: acá alcanza con no arrastrar la cola binaria
 * de dividir por la alícuota.
 */
function roundPrice(value: number): number {
  const factor = 10 ** PRICE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Los porcentajes de rentabilidad se leen de un vistazo: un decimal alcanza y sobra. */
function roundPercent(value: number): number {
  const factor = 10 ** PERCENT_DECIMALS;
  return Math.round(value * factor) / factor;
}
