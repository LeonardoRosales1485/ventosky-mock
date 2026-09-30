import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountOverrideDialogComponent,
  AccountOverrideDialogData,
} from './account-override-dialog.component';

const DATA: AccountOverrideDialogData = {
  partyName: 'Distribuidora Sur',
  detail: {
    accountUuid: 'account-uuid',
    balance: 90000,
    debtLimit: 100000,
    requested: 30000,
    available: 10000,
    excess: 20000,
    forcible: true,
    overridePermission: 'checking_account.override_limit',
  },
  canOverride: true,
};

describe('AccountOverrideDialogComponent', () => {
  let fixture: ComponentFixture<AccountOverrideDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const submit = (): void => {
    (fixture.componentInstance as unknown as { onSubmit: (event: Event) => void }).onSubmit(
      new Event('submit'),
    );
  };

  const setReason = (value: string): void => {
    const textarea = host().querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const create = async (data: AccountOverrideDialogData = DATA): Promise<void> => {
    close = vi.fn();
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [AccountOverrideDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountOverrideDialogComponent);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await create();
  });

  /**
   * Los cuatro números que explican el rechazo, tal como los mandó el backend: el saldo, el tope, lo
   * que se quiso llevar y lo que sí entra. Con «no se puede» a secas el cajero levanta el teléfono.
   */
  it('muestra saldo, limite, pedido y disponible', () => {
    const text = host().textContent ?? '';

    expect(text).toContain('90.000');
    expect(text).toContain('100.000');
    expect(text).toContain('30.000');
    expect(text).toContain('10.000');
  });

  /**
   * El diálogo **ofrece el máximo y no sólo el rechazo**: las dos salidas que no exigen autorizar
   * nada se dicen antes que el forzado.
   */
  it('ofrece las dos salidas que no exigen permiso', () => {
    const text = host().textContent ?? '';

    expect(text).toContain('checkingAccounts.overrideDialog.wayTakeAvailable');
    expect(text).toContain('checkingAccounts.overrideDialog.wayChargeRest');
  });

  /**
   * «El flujo de override pide motivo.»
   *
   * Sin él el backend responde 400 aunque el permiso esté: una deuda por encima del límite sin nada
   * que la explique es exactamente el registro que la excepción existe para evitar.
   */
  it('sin motivo no autoriza', () => {
    submit();

    expect(close).not.toHaveBeenCalled();
  });

  /** Ni con una palabra: lo que se lee dentro de dos años tiene que decir algo. */
  it('un motivo demasiado corto tampoco', () => {
    setReason('ok');
    submit();

    expect(close).not.toHaveBeenCalled();
  });

  it('con motivo devuelve el motivo', () => {
    setReason('Autorizado por el dueño, entrega pactada');
    submit();

    expect(close).toHaveBeenCalledWith('Autorizado por el dueño, entrega pactada');
  });

  /** Un motivo con espacios al final no es una explicación distinta. */
  it('recorta el motivo', () => {
    setReason('   Habló con gerencia   ');
    submit();

    expect(close).toHaveBeenCalledWith('Habló con gerencia');
  });

  /**
   * Sin el permiso el bloque de forzado queda **visible y deshabilitado**, con el nombre del permiso
   * a la vista: esconderlo dejaría al cajero sin saber qué pedir. Las dos salidas de arriba siguen.
   */
  it('sin el permiso no ofrece forzar, pero dice cual falta', async () => {
    await create({ ...DATA, canOverride: false });

    const text = host().textContent ?? '';
    expect(text).toContain('checkingAccounts.overrideDialog.needsPermission');
    expect(text).toContain('checkingAccounts.overrideDialog.wayTakeAvailable');
    // Ni motivo ni botón de confirmar: no hay nada que autorizar desde esta sesión.
    expect(host().querySelector('textarea')).toBeNull();
    expect(text).not.toContain('checkingAccounts.overrideDialog.confirm');
  });
});
