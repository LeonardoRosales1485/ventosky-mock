import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { CashRegisterDto } from '../../data-access/cash-register.model';
import {
  CashRegisterFormDialogComponent,
  CashRegisterFormDialogData,
  CashRegisterFormDialogResult,
} from './cash-register-form-dialog.component';

describe('CashRegisterFormDialogComponent', () => {
  let fixture: ComponentFixture<CashRegisterFormDialogComponent>;
  let http: HttpTestingController;
  let close: ReturnType<typeof vi.fn>;
  let data: CashRegisterFormDialogData;

  const CASH_REGISTER: CashRegisterDto = {
    uuid: 'cr-1',
    name: 'Caja 1',
    active: true,
    branch: { uuid: 'branch-a', name: 'Centro' },
    assignedUsers: [{ uuid: 'user-1', name: 'cajero1' }],
    version: 4,
  };

  /** Un campo del formulario, con lo justo para escribirlo desde el test. */
  type Field<T> = () => { value: { set(value: T): void } };

  /** Acceso a los miembros `protected` que la plantilla usa. */
  const dialog = () =>
    fixture.componentInstance as unknown as {
      cashRegisterForm: {
        name: Field<string>;
        branchUuid: Field<string>;
        active: Field<boolean>;
        assignedUserUuids: Field<string[]>;
      };
    };

  const render = (): void => {
    fixture = TestBed.createComponent(CashRegisterFormDialogComponent);
    fixture.detectChanges();
  };

  /** Los dos catálogos que el diálogo pide al abrirse. */
  const flushCatalogues = (): void => {
    http.expectOne(apiUrl(API_ENDPOINTS.BRANCHES.PAGINATE)).flush({
      content: [
        { uuid: 'branch-a', name: 'Centro' },
        { uuid: 'branch-b', name: 'Norte' },
      ],
    });
    http.expectOne(apiUrl(API_ENDPOINTS.USERS.PAGINATE)).flush({
      content: [
        { uuid: 'user-1', username: 'cajero1' },
        { uuid: 'user-2', username: 'cajero2' },
      ],
    });
    fixture.detectChanges();
  };

  const submit = (): void => {
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  const closedWith = (): CashRegisterFormDialogResult => close.mock.calls[0][0];

  beforeEach(async () => {
    close = vi.fn();
    data = { cashRegister: null };

    await TestBed.configureTestingModule({
      imports: [CashRegisterFormDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialogRef, useValue: { close } },
        // Factory y no `useValue`: cada test define su `data` después de configurar el TestBed.
        { provide: MAT_DIALOG_DATA, useFactory: () => data },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  it('creates a cash register with its branch and no preassigned user', () => {
    render();
    flushCatalogues();

    dialog().cashRegisterForm.name().value.set('  Caja 2  ');
    dialog().cashRegisterForm.branchUuid().value.set('branch-b');
    fixture.detectChanges();
    submit();

    expect(closedWith()).toEqual({
      uuid: undefined,
      name: 'Caja 2',
      active: true,
      branchUuid: 'branch-b',
      assignedUserUuids: [],
      // Un alta no tiene versión que reenviar: el backend sólo valida el bloqueo optimista cuando
      // el payload trae `uuid`.
      version: undefined,
    });
  });

  it('preloads the cash register being edited, with its branch and preassigned users', () => {
    data = { cashRegister: CASH_REGISTER };
    render();
    flushCatalogues();

    submit();

    expect(closedWith()).toEqual({
      uuid: 'cr-1',
      name: 'Caja 1',
      active: true,
      branchUuid: 'branch-a',
      assignedUserUuids: ['user-1'],
      // La versión sale de la fila del paginate y viaja intacta: es la que el guardado reenvía
      // para que el backend detecte si alguien más tocó la caja mientras se editaba.
      version: 4,
    });
  });

  /**
   * El backend distingue "no toques las preasignaciones" (campo ausente) de "quitalas todas"
   * (lista vacía): quitar el último usuario tiene que llegar como lista vacía, no como ausencia.
   */
  it('reports an empty list when the last preassigned user is removed', () => {
    data = { cashRegister: CASH_REGISTER };
    render();
    flushCatalogues();

    dialog().cashRegisterForm.assignedUserUuids().value.set([]);
    fixture.detectChanges();
    submit();

    expect(closedWith().assignedUserUuids).toEqual([]);
  });

  it('preselects the branch the listing was filtered by', () => {
    data = { cashRegister: null, defaultBranchUuid: 'branch-b' };
    render();
    flushCatalogues();

    dialog().cashRegisterForm.name().value.set('Caja 3');
    fixture.detectChanges();
    submit();

    expect(closedWith().branchUuid).toBe('branch-b');
  });

  it('does not submit a cash register without a name', () => {
    render();
    flushCatalogues();

    dialog().cashRegisterForm.name().value.set('   ');
    dialog().cashRegisterForm.branchUuid().value.set('branch-a');
    fixture.detectChanges();
    submit();

    expect(close).not.toHaveBeenCalled();
  });

  it('does not submit a cash register without a branch', () => {
    render();
    flushCatalogues();

    dialog().cashRegisterForm.name().value.set('Caja 4');
    fixture.detectChanges();
    submit();

    expect(close).not.toHaveBeenCalled();
  });
});
