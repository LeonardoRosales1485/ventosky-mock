import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { OrderReceiver } from '../../../../core/orders/order-commit.model';
import { SaleCustomerDto } from '../../data-access/sale.model';
import { SaleReceiverComponent } from './sale-receiver.component';

const CUSTOMER: SaleCustomerDto = {
  uuid: 'customer-uuid',
  name: 'Distribuidora Sur SA',
  docType: 'CUIT',
  docNumber: '30111222333',
  taxCondition: 'MONOTRIBUTO',
};

describe('SaleReceiverComponent', () => {
  let fixture: ComponentFixture<SaleReceiverComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const summary = (): string =>
    host().querySelector('.receiver__summary')?.textContent?.trim() ?? '';

  const editButton = (): HTMLButtonElement | null =>
    host().querySelector<HTMLButtonElement>('.receiver__edit');

  const resetButton = (): HTMLButtonElement | null =>
    host().querySelector<HTMLButtonElement>('.receiver__reset');

  const nameInput = (): HTMLInputElement =>
    host().querySelector<HTMLInputElement>('.receiver__name input')!;

  const type = (input: HTMLInputElement, value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const create = (
    customer: SaleCustomerDto | null,
    receiver: OrderReceiver | null = null,
  ): void => {
    TestBed.configureTestingModule({
      providers: [provideNoopAnimations(), provideTranslateService()],
    });

    fixture = TestBed.createComponent(SaleReceiverComponent);
    fixture.componentRef.setInput('customer', customer);
    fixture.componentRef.setInput('receiver', receiver);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * El caso frecuente no pide nada: se emite a nombre del cliente elegido. Precargar es sólo
   * mostrar — el receptor sigue en `null`, el commit no manda el bloque, y el backend copia
   * exactamente esos mismos campos de la ficha.
   */
  it('muestra la ficha del cliente sin darla por editada', () => {
    create(CUSTOMER);

    expect(summary()).toContain('Distribuidora Sur SA');
    expect(summary()).toContain('30111222333');
    expect(fixture.componentInstance.receiver()).toBeNull();
  });

  /** Sin cliente y sin nada tipeado, el comprobante sale a consumidor final, y conviene decirlo. */
  it('anuncia consumidor final cuando no hay cliente', () => {
    create(null);

    expect(summary()).toContain('sales.receiver.finalConsumer');
  });

  /**
   * Abrir el bloque lo materializa entero, aunque no se cambie una letra. Es la contrapartida de que
   * el backend lo trate como un todo: media edición sobre la ficha del cliente —el nombre nuevo con
   * la condición de IVA vieja— sería un receptor que nunca existió.
   */
  it('al abrirlo, congela la ficha completa como receptor', () => {
    create(CUSTOMER);

    editButton()!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.receiver()).toEqual({
      receiverName: 'Distribuidora Sur SA',
      receiverDocType: 'CUIT',
      receiverDocNumber: '30111222333',
      receiverTaxCondition: 'MONOTRIBUTO',
    });
  });

  /** Facturar a otro CUIT: el nombre se pisa y el resto del bloque sigue siendo el que se muestra. */
  it('pisa un campo sin perder los demás', () => {
    create(CUSTOMER);

    editButton()!.click();
    fixture.detectChanges();
    type(nameInput(), 'Otra Razón Social SRL');

    expect(fixture.componentInstance.receiver()?.receiverName).toBe('Otra Razón Social SRL');
    expect(fixture.componentInstance.receiver()?.receiverDocNumber).toBe('30111222333');
  });

  /** Vaciar todo vuelve a `null` y no a un bloque de campos vacíos, que significaría otra cosa. */
  it('vuelve a no-editado cuando se borra todo lo tipeado', () => {
    create(null);

    editButton()!.click();
    fixture.detectChanges();
    type(nameInput(), 'Juan Pérez');
    expect(fixture.componentInstance.receiver()).not.toBeNull();

    type(nameInput(), '   ');

    expect(fixture.componentInstance.receiver()).toBeNull();
  });

  it('el botón de volver atrás suelta lo editado', () => {
    create(CUSTOMER, { receiverName: 'Otra Razón Social SRL' });

    resetButton()!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.receiver()).toBeNull();
    expect(summary()).toContain('Distribuidora Sur SA');
  });

  /**
   * Un receptor que ya venía editado —el diálogo que se reabre tras un commit fallido— arranca
   * abierto: esconderlo sería perder de vista lo que alguien escribió sin haberlo borrado.
   */
  it('arranca abierto cuando el receptor ya venía editado', () => {
    create(CUSTOMER, { receiverName: 'Otra Razón Social SRL' });

    expect(editButton()).toBeNull();
    expect(nameInput().value).toBe('Otra Razón Social SRL');
  });
});
