import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DelinquencyDialogComponent,
  DelinquencyDialogData,
  DelinquencyDialogResult,
} from './delinquency-dialog.component';

const DATA: DelinquencyDialogData = {
  partyName: 'Distribuidora Sur',
  currentLevel: 'EN_MORA',
  overdueAmount: 84000,
  oldestOverdueDays: 47,
  history: [
    {
      uuid: 'event-1',
      accountUuid: 'account-uuid',
      level: 'EN_MORA',
      previousLevel: 'AL_DIA',
      reason: 'Se atraso 30 dias con la factura de agosto',
      dateDecided: '2026-09-05T10:00:00.000',
    },
  ],
};

describe('DelinquencyDialogComponent', () => {
  let fixture: ComponentFixture<DelinquencyDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [DelinquencyDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MAT_DIALOG_DATA, useValue: DATA },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DelinquencyDialogComponent);
    fixture.detectChanges();
  });

  function component() {
    return fixture.componentInstance as unknown as {
      level: { (): DelinquencyDialogResult['level']; set: (value: DelinquencyDialogResult['level']) => void };
      reasonForm: { reason: () => { value: () => string } };
      onSubmit: (event: Event) => void;
    };
  }

  function setReason(value: string): void {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Arranca en el nivel que la cuenta ya tiene: el diálogo no propone un cambio por su cuenta. */
  it('abre en el nivel actual de la cuenta', () => {
    // Contra el estado del componente y no contra el DOM: el radio de Material no refleja la
    // seleccion ni en `input:checked` ni en `aria-checked` bajo el TestBed, y lo que hay que fijar
    // es que el dialogo no proponga un cambio por su cuenta.
    expect(component().level()).toBe('EN_MORA');
  });

  /**
   * Los dos números calculados van a la vista, no en otra pantalla: el chip dice lo que alguien
   * decidió y estos dicen lo que pasó, y quien decide tiene que ver las dos cosas juntas.
   */
  it('muestra el vencido y los dias de la deuda mas antigua', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // El importe lo pinta `app-currency-display`, que no depende de las traducciones.
    expect(text).toContain('84.000');
    // Los dias van por una clave con interpolacion; en el test las traducciones no estan cargadas,
    // asi que lo que se comprueba es que se eligio ESA rama y no la de "nada vencido".
    expect(text).toContain('delinquencyDialog.days');
    expect(text).not.toContain('nothingOverdue');
  });

  /** «Cambiar el nivel sin motivo no deja guardar.» */
  it('sin motivo no cierra el dialogo', () => {
    component().level.set('MOROSO_GRAVE');
    component().onSubmit(new Event('submit'));

    expect(close).not.toHaveBeenCalled();
  });

  /** Ni con un motivo de una palabra: lo que se lee dentro de dos años tiene que decir algo. */
  it('un motivo demasiado corto tampoco', () => {
    setReason('no');
    component().onSubmit(new Event('submit'));

    expect(close).not.toHaveBeenCalled();
  });

  it('con nivel y motivo devuelve los dos', () => {
    component().level.set('MOROSO_GRAVE');
    setReason('Expediente derivado al estudio juridico');
    component().onSubmit(new Event('submit'));

    expect(close).toHaveBeenCalledWith({
      level: 'MOROSO_GRAVE',
      reason: 'Expediente derivado al estudio juridico',
    });
  });

  /** El motivo se recorta: un campo con espacios al final no es una explicacion distinta. */
  it('recorta el motivo', () => {
    setReason('   Hablamos con el abogado   ');
    component().onSubmit(new Event('submit'));

    expect(close).toHaveBeenCalledWith({
      level: 'EN_MORA',
      reason: 'Hablamos con el abogado',
    });
  });

  /** Sin nada vencido no se inventa un cero de días: se dice que no hay nada vencido. */
  it('sin nada vencido no muestra dias', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DelinquencyDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: { ...DATA, overdueAmount: 0, oldestOverdueDays: null },
        },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    }).compileComponents();

    const other = TestBed.createComponent(DelinquencyDialogComponent);
    other.detectChanges();

    const text = (other.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('nothingOverdue');
  });
});
