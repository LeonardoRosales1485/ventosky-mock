import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccountAvailabilityDto } from '../account-availability.model';
import { AccountPanelComponent } from './account-panel.component';

/** Lo que contesta `/availability` para una venta: los cuatro números y la decisión, ya resueltos. */
const SALE: AccountAvailabilityDto = {
  accountUuid: 'account-uuid',
  partyName: 'Distribuidora Sur',
  operation: 'SALE',
  allowed: true,
  blockedReason: null,
  balance: 80000,
  overdueAmount: 84000,
  debtLimit: 100000,
  available: 20000,
  delinquencyLevel: 'EN_MORA',
  enabled: true,
};

describe('AccountPanelComponent', () => {
  let fixture: ComponentFixture<AccountPanelComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => host().textContent ?? '';

  const render = (availability: AccountAvailabilityDto | null, loading = false): void => {
    fixture.componentRef.setInput('availability', availability);
    fixture.componentRef.setInput('loading', loading);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountPanelComponent],
      providers: [provideNoopAnimations(), provideTranslateService()],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountPanelComponent);
  });

  /**
   * «El chip y el disponible aparecen al seleccionar el cliente, antes de cargar nada.»
   *
   * Los cuatro juntos: el nivel que alguien decidió, el vencido y el saldo que sí están calculados,
   * y el disponible que resolvió el portón.
   */
  it('muestra chip, saldo, vencido y disponible', () => {
    render(SALE);

    expect(host().querySelector('app-delinquency-chip')).not.toBeNull();
    // Los importes los pinta `app-currency-display`, que no depende de las traducciones.
    expect(text()).toContain('80.000');
    expect(text()).toContain('84.000');
    expect(text()).toContain('20.000');
  });

  /**
   * «Un cliente marcado `MOROSO_GRAVE` puede comprar a cuenta sin ningún cartel bloqueante.»
   *
   * El chip informa y no interrumpe: ninguno de los cuatro niveles bloquea, y el panel no insinúa lo
   * contrario. Lo único que se pinta como bloqueo es la cuenta deshabilitada.
   */
  it('el peor nivel de morosidad no pinta ningun bloqueo', () => {
    render({ ...SALE, delinquencyLevel: 'MOROSO_GRAVE' });

    expect(host().querySelector('.account__blocked')).toBeNull();
    expect(host().querySelector('.account--disabled')).toBeNull();
    // Y sigue diciendo qué puede llevar: el disponible no depende del nivel.
    expect(text()).toContain('20.000');
  });

  /** «Una cuenta deshabilitada sí deshabilita el medio, con el motivo visible.» */
  it('la cuenta deshabilitada se dice, con su motivo', () => {
    render({
      ...SALE,
      allowed: false,
      blockedReason: 'ACCOUNT_DISABLED',
      enabled: false,
    });

    expect(host().querySelector('.account__blocked')).not.toBeNull();
    expect(text()).toContain('panel.disabled');
  });

  /**
   * «En una compra no aparece ningún límite.»
   *
   * No hay nada que consumir —cuánto nos fía un proveedor lo decide el proveedor— y mostrar un tope
   * que no se valida es una invitación a que alguien lo implemente. El backend manda los dos en
   * nulo, y el panel omite la columna entera en vez de pintar un cero.
   */
  it('en una compra no muestra ni disponible ni limite', () => {
    render({
      ...SALE,
      operation: 'PURCHASE',
      debtLimit: null,
      available: null,
    });

    expect(host().querySelector('.account__figure--available')).toBeNull();
    expect(text()).not.toContain('panel.available');
    // El saldo y lo vencido sí: son la razón por la que el panel está en la compra.
    expect(text()).toContain('80.000');
    expect(text()).toContain('84.000');
  });

  /**
   * Sin tope, el disponible no es cero: es «no hay nada que consumir». Un cero se leería como un
   * cliente agotado, que es la lectura opuesta.
   */
  it('sin tope dice que no hay tope, y no un disponible en cero', () => {
    render({ ...SALE, debtLimit: 500000, available: null });

    expect(text()).toContain('panel.unlimited');
    expect(text()).not.toContain('$ 0');
  });

  /** Sin titular elegido no hay panel: no se afirma nada sobre una cuenta que nadie preguntó. */
  it('sin respuesta no dibuja nada', () => {
    render(null);

    expect(host().querySelector('.account')).toBeNull();
    expect(host().querySelector('.account__loading')).toBeNull();
  });

  it('mientras la consulta viaja lo dice', () => {
    render(null, true);

    expect(text()).toContain('panel.loading');
  });
});
