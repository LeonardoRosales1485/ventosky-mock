import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { PurchaseCartLineView, PurchaseProductDto } from '../../data-access/purchase.model';
import { PurchaseCartComponent } from './purchase-cart.component';

const SNEAKERS: PurchaseProductDto = {
  uuid: 'p-1',
  name: 'Zapatillas',
  sku: 'ZAP-1',
  taxRate: 21,
  unitDecimalPlaces: 0,
  isForPurchase: true,
};

const SOCKS: PurchaseProductDto = { ...SNEAKERS, uuid: 'p-2', name: 'Medias', sku: 'MED-1' };

/**
 * Una línea como la que arma `PurchaseCart.lineViews()`: **objeto nuevo en cada recálculo**, que es
 * justamente lo que la tabla tiene que reconocer como la misma fila.
 */
function line(product: PurchaseProductDto, unitCost: number | null): PurchaseCartLineView {
  return {
    product,
    quantity: 1,
    unitCost,
    taxRate: 21,
    amounts:
      unitCost === null
        ? null
        : {
            unitPrice: unitCost,
            discountAmount: 0,
            netAmount: unitCost,
            taxAmount: 0,
            subtotal: unitCost,
          },
    missingCost: unitCost === null,
    requiresBatches: false,
    allocatedQuantity: 0,
    batchIssue: null,
    batches: [],
    requiresSerials: false,
    serialIssue: null,
    packageQuantity: null,
    serials: [],
    packaging: null,
  };
}

describe('PurchaseCartComponent', () => {
  let fixture: ComponentFixture<PurchaseCartComponent>;

  const setLines = (lines: readonly PurchaseCartLineView[]): void => {
    fixture.componentRef.setInput('lines', lines);
    fixture.detectChanges();
  };

  /** Los inputs de costo, en el orden en que se dibujan las filas. */
  const costInputs = (): HTMLInputElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.cart__cost-input'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PurchaseCartComponent],
      providers: [provideNoopAnimations(), provideTranslateService()],
    }).compileComponents();

    fixture = TestBed.createComponent(PurchaseCartComponent);
    setLines([line(SNEAKERS, null), line(SOCKS, 500)]);
  });

  /**
   * El costo se tipea dígito a dígito, y cada tecla rehace la lista entera de líneas. Si la tabla
   * tratara cada objeto nuevo como una fila nueva, destruiría el `<input>` que se está usando y el
   * foco se perdería en la primera tecla: escribir un costo de cuatro cifras sería imposible.
   */
  it('conserva el foco del campo de costo cuando la lista se recalcula', () => {
    const input = costInputs()[0];
    input.focus();
    expect(document.activeElement).toBe(input);

    // Lo que hace el carrito ante una tecla: mismos productos, objetos nuevos.
    setLines([line(SNEAKERS, 1), line(SOCKS, 500)]);

    expect(document.activeElement).toBe(input);
    expect(costInputs()[0]).toBe(input);
  });

  it('refleja en el campo el costo recalculado', () => {
    setLines([line(SNEAKERS, 1234), line(SOCKS, 500)]);

    expect(costInputs()[0].value).toBe('1234');
  });

  /** Quitar una línea sí tiene que rehacer las filas: la que se va no puede quedar dibujada. */
  it('deja de dibujar la línea quitada', () => {
    setLines([line(SOCKS, 500)]);

    expect(costInputs()).toHaveLength(1);
    expect(costInputs()[0].value).toBe('500');
  });
});
