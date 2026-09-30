import { Signal, computed, signal } from '@angular/core';
import {
  PackagingDefaults,
  PackagingRef,
  baseQuantityOf,
  defaultPackagingOf,
  packageQuantityOf,
} from '../../../core/product/product-lookup.model';
import { clampQuantity, quantityDecimalsOf } from '../../../core/product/quantity-precision';
import { PickerProduct } from '../../../core/product-picker/product-picker.model';
import { isSerialTracked } from '../../../core/stock/stock-serial.model';
import { WarehouseDto } from '../../../core/warehouse/warehouse.model';
import {
  TransferBatchAllocationPayload,
  TransferItemPayload,
  TransferMode,
  TransferSourceBatch,
} from '../data-access/stock-transfer.model';

/**
 * El reparto de una línea entre lotes del depósito de origen, cuando el operador lo eligió a mano.
 *
 * Guarda el lote entero y no sólo su uuid porque la fila del formulario muestra su número y su
 * vencimiento sin volver a pedirlos.
 */
export interface TransferLotSplit {
  batch: TransferSourceBatch;
  quantity: number;
}

/** Una línea del traslado en armado: qué producto, cuánto y —opcionalmente— de qué lotes. */
export interface TransferDraftLine {
  product: PickerProduct;
  quantity: number;
  /**
   * Reparto manual. Vacío significa «que decida la política de asignación de la sucursal», que es
   * como sale el 99% de los traslados; no significa «sin lotes».
   */
  lots: readonly TransferLotSplit[];
  /**
   * Las unidades que se van, en un producto `SERIAL`. Vacío en todo el resto del catálogo.
   *
   * Acá la relación con {@link quantity} se invierte: no se elige una cantidad y después de dónde
   * sale, se eligen **unidades** y la cantidad es cuántas son (RN-17). Por eso `setSerials` la
   * escribe y `setQuantity` no toca estas líneas.
   */
  serials: readonly string[];
  /**
   * Los empaques declarados del producto. Vacío puede ser «no tiene» o «todavía no llegaron»: la
   * pantalla los pide al agregar la línea, porque el paginado no los trae.
   */
  packagings: readonly PackagingDefaults[];
  /**
   * En qué unidad está cargando el operador, o `null` para la unidad base.
   *
   * **No cambia lo que se manda** (RN-16): {@link quantity} es siempre unidad base y el payload no
   * se entera de que existen los empaques. Esto es sólo el factor con el que la pantalla convierte
   * lo que el operador escribe, para que mover diez cajas de doce no sea escribir 120 a mano.
   */
  packaging: PackagingRef | null;
}

/** Cuánto stock tiene el producto en el depósito de origen, y cuánto se le está pidiendo. */
export interface TransferDraftLineView extends TransferDraftLine {
  /** Saldo del producto en el depósito de origen. `null` mientras no se leyó. */
  availableAtSource: number | null;
  /** Cuánto falta para cubrir la línea. `0` cuando alcanza o cuando todavía no se sabe. */
  shortage: number;
  /** Si el reparto manual está cargado y suma la cantidad de la línea. */
  lotsBalanced: boolean;
  /** Si la línea se despacha eligiendo unidades en vez de escribiendo una cantidad. */
  serialTracked: boolean;
  /**
   * Si la línea todavía no eligió sus unidades. Sólo puede ser `true` en una línea `SERIAL`: es lo
   * que traba el despacho, porque el backend la rechazaría con `SERIAL_COUNT_MISMATCH`.
   */
  missingSerials: boolean;
  /**
   * La cantidad expresada en el empaque elegido, o `null` si se está cargando en unidad base. Es lo
   * que muestra el input; el que viaja sigue siendo {@link TransferDraftLine.quantity}.
   */
  packageQuantity: number | null;
}

/**
 * Tolerancia con la que se compara el reparto contra la cantidad. Las cantidades pueden ser
 * fraccionarias, así que la suma arrastra error de punto flotante: sin holgura, un reparto exacto
 * quedaría «incompleto» por 1e-13 y el backend nunca vería el request.
 */
const QUANTITY_EPSILON = 1e-6;

/**
 * El traslado en armado: de dónde sale, a dónde va, con qué modalidad y qué se mueve.
 *
 * No habla con la API. Su única responsabilidad es sostener lo que el operador armó y derivar de
 * ahí los totales y las razones por las que el traslado todavía no se puede despachar; quien llama
 * al endpoint es la pantalla.
 *
 * A diferencia del carrito de compra no hay importes: un traslado no compra ni vende nada, mueve
 * stock. El costo viaja con el lote y lo pone el backend, no el operador.
 */
export class TransferDraft {
  private readonly _lines = signal<readonly TransferDraftLine[]>([]);
  private readonly _sourceWarehouse = signal<WarehouseDto | null>(null);
  private readonly _targetWarehouse = signal<WarehouseDto | null>(null);
  private readonly _targetBranchUuid = signal<string | null>(null);
  private readonly _mode = signal<TransferMode>('DEFERRED');

  /**
   * Saldo del producto en el depósito de origen, por uuid de producto. Lo puebla la pantalla al
   * agregar la línea y al cambiar el depósito: el `totalStock` que trae el selector es el de la
   * sucursal entera, y lo que acota el traslado es el depósito.
   */
  private readonly _stockAtSource = signal<ReadonlyMap<string, number>>(new Map());

  readonly lines = this._lines.asReadonly();
  readonly sourceWarehouse = this._sourceWarehouse.asReadonly();
  readonly targetWarehouse = this._targetWarehouse.asReadonly();
  readonly targetBranchUuid = this._targetBranchUuid.asReadonly();
  readonly mode = this._mode.asReadonly();

  readonly lineViews: Signal<readonly TransferDraftLineView[]> = computed(() => {
    const stock = this._stockAtSource();

    return this._lines().map((line) => {
      const available = stock.get(line.product.uuid) ?? null;
      const allocated = sumLots(line.lots);
      const serialTracked = isSerialTracked(line.product);

      return {
        ...line,
        availableAtSource: available,
        shortage: available === null ? 0 : Math.max(0, line.quantity - available),
        lotsBalanced:
          line.lots.length === 0 || Math.abs(allocated - line.quantity) <= QUANTITY_EPSILON,
        serialTracked,
        missingSerials: serialTracked && line.serials.length === 0,
        packageQuantity: packageQuantityOf(line.quantity, line.packaging),
      };
    });
  });

  readonly isEmpty = computed(() => this._lines().length === 0);
  readonly productCount = computed(() => this._lines().length);

  readonly totalQuantity = computed(() =>
    this._lines().reduce((total, line) => total + line.quantity, 0),
  );

  /** Cuántos lotes de origen quedaron declarados a mano; los automáticos los resuelve el backend. */
  readonly totalLots = computed(() =>
    this._lines().reduce((total, line) => total + line.lots.length, 0),
  );

  /** Las líneas que piden más de lo que el depósito tiene. Son las que van a pedir confirmación. */
  readonly linesWithShortage = computed(() => this.lineViews().filter((line) => line.shortage > 0));

  /** Las líneas cuyo reparto manual no cierra. El backend las rechaza, así que el botón no las manda. */
  readonly linesWithUnbalancedLots = computed(() =>
    this.lineViews().filter((line) => !line.lotsBalanced),
  );

  /** Las líneas `SERIAL` que todavía no dicen qué unidades se van. */
  readonly linesWithoutSerials = computed(() =>
    this.lineViews().filter((line) => line.missingSerials),
  );

  /**
   * Si el traslado está listo para despachar. El faltante de stock **no** lo bloquea: de eso decide
   * la política de la sucursal, y el 412 del backend es lo que abre el diálogo que lo confirma.
   */
  readonly isReadyToDispatch = computed(
    () =>
      !this.isEmpty() &&
      this._sourceWarehouse() !== null &&
      this._targetWarehouse() !== null &&
      this._sourceWarehouse()?.uuid !== this._targetWarehouse()?.uuid &&
      this.linesWithUnbalancedLots().length === 0 &&
      // Una línea `SERIAL` sin unidades elegidas no es un faltante que la sucursal pueda confirmar:
      // es una línea incompleta, y el backend la rechaza con `SERIAL_COUNT_MISMATCH`.
      this.linesWithoutSerials().length === 0,
  );

  /**
   * Cambiar el depósito de origen invalida todo lo que dependía de él: el saldo leído y, sobre
   * todo, los lotes elegidos a mano, que son lotes de **ese** depósito. Conservarlos mandaría al
   * backend uuids que su validación rechaza, y con razón.
   */
  setSourceWarehouse(warehouse: WarehouseDto | null): void {
    if (warehouse?.uuid === this._sourceWarehouse()?.uuid) {
      return;
    }

    this._sourceWarehouse.set(warehouse);
    this._stockAtSource.set(new Map());
    // Las series son tan de **ese** depósito como los lotes: una unidad del depósito viejo no está
    // en el nuevo, y mandarla igual termina en `SERIAL_NOT_AVAILABLE`.
    this._lines.update((lines) => lines.map((line) => ({ ...line, lots: [], serials: [] })));
  }

  setTargetWarehouse(warehouse: WarehouseDto | null): void {
    this._targetWarehouse.set(warehouse);
  }

  /** La sucursal de destino sólo acota el select de depósitos; el traslado viaja entre depósitos. */
  setTargetBranch(branchUuid: string | null): void {
    if (branchUuid === this._targetBranchUuid()) {
      return;
    }

    this._targetBranchUuid.set(branchUuid);
    this._targetWarehouse.set(null);
  }

  setMode(mode: TransferMode): void {
    this._mode.set(mode);
  }

  setStockAtSource(productUuid: string, quantity: number): void {
    this._stockAtSource.update((current) => new Map(current).set(productUuid, quantity));
  }

  /**
   * Agrega el producto, o le suma la cantidad si ya está en el traslado: leer dos veces el mismo
   * código son dos unidades del mismo renglón, no dos renglones.
   */
  addProduct(product: PickerProduct, quantity = 1): void {
    const existing = this._lines().find((line) => line.product.uuid === product.uuid);
    if (existing) {
      this.setQuantity(product.uuid, existing.quantity + quantity);
      return;
    }

    this._lines.update((lines) => [
      ...lines,
      {
        product,
        // Una línea `SERIAL` nace en cero: su cantidad son las unidades elegidas, y todavía no hay
        // ninguna. Arrancarla en 1 diría que ya se eligió una.
        quantity: isSerialTracked(product) ? 0 : clampQuantity(quantity, quantityDecimalsOf(product)),
        lots: [],
        serials: [],
        packagings: [],
        packaging: null,
      },
    ]);
  }

  /**
   * Cambia la cantidad de la línea y **descarta el reparto manual**, que estaba hecho contra la
   * cantidad anterior: dejarlo lo volvería un reparto que no cierra sin que nadie lo tocara.
   */
  setQuantity(productUuid: string, quantity: number): void {
    this._lines.update((lines) =>
      lines.map((line) => {
        // En una línea `SERIAL` la cantidad es un derivado de las unidades elegidas: dejarla escribir
        // la desincronizaría de `serials` y el commit la rechazaría con `SERIAL_COUNT_MISMATCH`.
        if (line.product.uuid !== productUuid || isSerialTracked(line.product)) {
          return line;
        }

        const next = clampQuantity(quantity, quantityDecimalsOf(line.product));
        return next === line.quantity ? line : { ...line, quantity: next, lots: [] };
      }),
    );
  }

  /**
   * Guarda los empaques que declara el producto y adopta el de compra por defecto, si hay.
   *
   * Se adopta el **de compra** y no el de venta porque un traslado repone: mueve mercadería como
   * llega del proveedor —un bulto, una caja—, no como se despacha al cliente. La cantidad que ya
   * tenía la línea no se toca: está en unidad base y sigue significando lo mismo; lo único que
   * cambia es en qué unidad se la muestra.
   *
   * Una línea `SERIAL` no adopta ninguno: ahí la cantidad son las unidades elegidas (RN-17) y una
   * caja de doce series no es una cantidad, son doce elecciones.
   */
  setPackagings(productUuid: string, packagings: readonly PackagingDefaults[]): void {
    this._lines.update((lines) =>
      lines.map((line) => {
        if (line.product.uuid !== productUuid) {
          return line;
        }

        const packaging = isSerialTracked(line.product)
          ? null
          : defaultPackagingOf(packagings, 'purchase');
        return { ...line, packagings, packaging };
      }),
    );
  }

  /**
   * Cambia la unidad en la que se carga la línea, **conservando la cantidad en unidad base**.
   *
   * Es a propósito: el operador que ya cargó 24 unidades y después elige «Caja x 12» quiere ver
   * «2 cajas», no que se le multipliquen las unidades por doce. La conversión es de presentación y
   * el saldo que se mueve no cambia porque alguien haya cambiado de anteojos.
   */
  setPackaging(productUuid: string, packaging: PackagingRef | null): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid ? { ...line, packaging } : line,
      ),
    );
  }

  /**
   * La cantidad escrita **en el empaque elegido**: se convierte a unidad base antes de guardarla,
   * que es la única forma en la que la línea existe.
   */
  setPackageQuantity(productUuid: string, packageQuantity: number): void {
    const line = this._lines().find((row) => row.product.uuid === productUuid);
    if (!line) {
      return;
    }

    this.setQuantity(productUuid, baseQuantityOf(packageQuantity, line.packaging));
  }

  /**
   * Guarda las unidades elegidas de una línea `SERIAL` **y con ellas la cantidad**: son el mismo
   * dato dicho una sola vez (RN-17).
   *
   * También descarta el reparto por lote, que en estas líneas no se usa: la unidad ya dice de qué
   * partida sale, así que conservarlo sería mandar dos respuestas para la misma pregunta.
   */
  setSerials(productUuid: string, serials: readonly string[]): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid
          ? { ...line, serials: [...serials], quantity: serials.length, lots: [] }
          : line,
      ),
    );
  }

  /** Guarda el reparto por lotes de la línea. Una lista vacía la devuelve a la política automática. */
  setLots(productUuid: string, lots: readonly TransferLotSplit[]): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid
          ? { ...line, lots: lots.filter((lot) => lot.quantity > 0) }
          : line,
      ),
    );
  }

  removeProduct(productUuid: string): void {
    this._lines.update((lines) => lines.filter((line) => line.product.uuid !== productUuid));
  }

  clear(): void {
    this._lines.set([]);
  }

  /** Las líneas en la forma que espera `POST /stock-transfer/transfer`. */
  toItems(): TransferItemPayload[] {
    return this._lines().map((line) => ({
      product: { uuid: line.product.uuid },
      quantity: line.quantity,
      // Nunca las dos: con series el backend ignora `allocations`, y mandarlas sería declarar dos
      // veces de qué lote sale la línea.
      ...(line.serials.length > 0
        ? { serials: [...line.serials] }
        : line.lots.length > 0
          ? { allocations: toAllocations(line.lots) }
          : {}),
    }));
  }
}

function sumLots(lots: readonly TransferLotSplit[]): number {
  return lots.reduce((total, lot) => total + lot.quantity, 0);
}

function toAllocations(lots: readonly TransferLotSplit[]): TransferBatchAllocationPayload[] {
  return lots.map((lot) => ({ batchUuid: lot.batch.uuid, quantity: lot.quantity }));
}
