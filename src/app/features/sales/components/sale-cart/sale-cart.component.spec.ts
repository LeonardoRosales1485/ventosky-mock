import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { SaleCartLineView, SalePriceListDto } from '../../data-access/sale.model';
import { SaleCartComponent } from './sale-cart.component';

const RETAIL: SalePriceListDto = { uuid: 'retail-uuid', name: 'Minorista', isPrincipal: true };
const WHOLESALE: SalePriceListDto = { uuid: 'wholesale-uuid', name: 'Mayorista' };

const COLA: SaleCartLineView = {
  product: { uuid: 'cola-uuid', name: 'Gaseosa Cola 1.5L', totalStock: 12 },
  quantity: 1,
  unitPrice: 1000,
  priceListUuid: RETAIL.uuid,
  chosenPriceListUuid: null,
  taxRate: 21,
  amounts: null,
  promotions: [],
  shortage: 0,
  priceIssue: null,
  batchTracked: false,
  batchShortage: 0,
  chosenBatch: null,
  kit: null,
  kitComponents: [],
  serialTracked: false,
  serialShortage: 0,
  serials: [],
  packageQuantity: null,
  packaging: null,
};

/**
 * El encabezado de la columna «Lista» es el disparador de la lista de todo el carrito: es el único
 * lugar de la pantalla desde donde se elige, así que lo que se prueba es que abra y que lo elegido
 * salga del componente tal cual —incluido el `null` que la devuelve a la del cliente—.
 */
describe('SaleCartComponent — lista del carrito', () => {
  let fixture: ComponentFixture<SaleCartComponent>;
  let chosen: (string | null)[];

  /** El botón del encabezado, el que abre el menú. */
  const header = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.cart__cart-list') as HTMLButtonElement;

  /** El texto de la opción sin la ligadura del ícono de la tilde, que no es contenido. */
  const label = (item: HTMLElement): string => (item.textContent ?? '').replace('check', '').trim();

  const openMenu = (): HTMLElement[] => {
    header().click();
    fixture.detectChanges();

    return [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideNoopAnimations(), provideTranslateService()],
    });

    fixture = TestBed.createComponent(SaleCartComponent);
    fixture.componentRef.setInput('lines', [COLA]);
    fixture.componentRef.setInput('stockPolicy', 'WARNING_CONFIRMATION');
    fixture.componentRef.setInput('priceLists', [RETAIL, WHOLESALE]);

    chosen = [];
    fixture.componentInstance.cartPriceListChange.subscribe((uuid) => chosen.push(uuid));
    fixture.detectChanges();
  });

  it('ofrece la automática y cada lista, con la vigente marcada', () => {
    fixture.componentRef.setInput('cartPriceListUuid', WHOLESALE.uuid);
    fixture.detectChanges();

    const items = openMenu();

    expect(items.map(label)).toEqual(['sales.cart.priceListAuto', RETAIL.name, WHOLESALE.name]);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ]);
  });

  it('elegir una lista la pide para todo el carrito', () => {
    openMenu()[2].click();

    expect(chosen).toEqual([WHOLESALE.uuid]);
  });

  it('la automática la devuelve a la del cliente', () => {
    fixture.componentRef.setInput('cartPriceListUuid', WHOLESALE.uuid);
    fixture.detectChanges();

    openMenu()[0].click();

    expect(chosen).toEqual([null]);
  });

  /** Sin la lista a la vista, el carrito vacío no tendría dónde leer con qué se va a cobrar. */
  it('el encabezado nombra la lista fijada', () => {
    expect(header().querySelector('.cart__cart-list-value')).toBeNull();

    fixture.componentRef.setInput('cartPriceListUuid', WHOLESALE.uuid);
    fixture.detectChanges();

    expect(header().querySelector('.cart__cart-list-value')?.textContent).toContain(WHOLESALE.name);
  });

  /** Un cajero sin `price_list.view` recibe el catálogo vacío: no hay lista que elegir ni columna. */
  it('sin listas no hay columna ni disparador', () => {
    fixture.componentRef.setInput('priceLists', []);
    fixture.detectChanges();

    expect(header()).toBeNull();
  });
});
