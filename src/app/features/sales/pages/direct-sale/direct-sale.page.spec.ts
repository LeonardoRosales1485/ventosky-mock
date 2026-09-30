import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { Mock, afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { AccountAvailabilityDto } from '../../../../core/checking-accounts/account-availability.model';
import { AccountOverrideDialogComponent } from '../../../../core/checking-accounts/account-override-dialog/account-override-dialog.component';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { FullscreenService } from '../../../../core/layout/fullscreen.service';
import { SaleCustomerDto } from '../../data-access/sale.model';
import { DirectSalePage } from './direct-sale.page';

const CUSTOMER: SaleCustomerDto = { uuid: 'role-uuid', name: 'Distribuidora Sur' };

const AVAILABILITY: AccountAvailabilityDto = {
  accountUuid: 'account-uuid',
  partyName: 'Distribuidora Sur',
  operation: 'SALE',
  allowed: true,
  blockedReason: null,
  balance: 80000,
  overdueAmount: 0,
  debtLimit: 100000,
  available: 20000,
  delinquencyLevel: 'EN_MORA',
  enabled: true,
};

/** El 400 del portón con el detalle estructurado y la marca de forzable que pone el backend. */
const LIMIT_REJECTION = new HttpErrorResponse({
  status: 400,
  error: {
    errorCode: 'ACCOUNT_DEBT_LIMIT_EXCEEDED',
    userMessage: 'La operación deja al cliente por encima de su límite.',
    data: {
      accountDebtLimit: {
        accountUuid: 'account-uuid',
        balance: 90000,
        debtLimit: 100000,
        requested: 30000,
        available: 10000,
        excess: 20000,
        forcible: true,
        overridePermission: 'checking_account.override_limit',
      },
    },
  },
});

interface PageInternals {
  cart: { setCustomer: (customer: SaleCustomerDto | null) => void };
  availability: () => AccountAvailabilityDto | null;
  availabilityLoading: () => boolean;
  noAccount: () => boolean;
  onCommitFailed: (error: unknown, overrides: unknown) => void;
}

/**
 * La pantalla del mostrador, acotada a lo que trajo VTY-424: el panel del titular y la excepción
 * autorizada. El resto de la venta —carrito, precios, cobro— vive en sus propias unidades.
 */
describe('DirectSalePage', () => {
  let fixture: ComponentFixture<DirectSalePage>;
  let http: HttpTestingController;
  let permissions: Set<string>;
  let openDialog: Mock;

  const availabilityUrl = (partyRoleUuid: string): string =>
    apiUrl(
      `${API_ENDPOINTS.CHECKING_ACCOUNTS.BY_PARTY_ROLE}/${partyRoleUuid}` +
        API_ENDPOINTS.CHECKING_ACCOUNTS.AVAILABILITY_SUFFIX,
    );

  /** El componente, con lo `protected` a la vista: el spec mira desde adentro a propósito. */
  const page = (): PageInternals => fixture.componentInstance as unknown as PageInternals;

  /**
   * Los catálogos del arranque caen a su vacío con un error: cada uno lo absorbe con su
   * `catchError`, así que la pantalla queda armada y sin ninguno de ellos de por medio.
   */
  const settleCatalogs = (): void => {
    http.match(() => true).forEach((request) => request.error(new ProgressEvent('error')));
    fixture.detectChanges();
  };

  const create = (granted: readonly string[] = []): void => {
    permissions = new Set(granted);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
        {
          provide: AuthService,
          useValue: {
            hasPermission: (permission: string) => permissions.has(permission),
            selectedBranchUuid: () => 'branch-uuid',
            // La barra nombra al vendedor con el usuario de la sesión.
            authUser: () => null,
          },
        },
        // La pantalla completa la pide un botón de la barra; acá sólo hay que no tocar el documento.
        {
          provide: FullscreenService,
          useValue: { active: () => false, exit: vi.fn(), request: vi.fn(), toggle: vi.fn() },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(DirectSalePage);
    fixture.detectChanges();
    settleCatalogs();

    openDialog = vi.fn().mockReturnValue({ afterClosed: () => of(undefined) });
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation(openDialog);
  };

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  /* ───────────────────────────  El panel del titular  ─────────────────────────── */

  /**
   * «El chip y el disponible aparecen al seleccionar el cliente, antes de cargar nada.»
   *
   * Se pregunta por el uuid del **rol**, que es lo que la pantalla tiene en la mano, y **sin
   * importe**: la pregunta de este momento es «¿puede llevar algo a cuenta?».
   */
  it('al elegir el cliente pide su disponible, por el rol y sin importe', () => {
    create();

    page().cart.setCustomer(CUSTOMER);
    fixture.detectChanges();

    const request = http.expectOne((candidate) => candidate.url === availabilityUrl(CUSTOMER.uuid));
    expect(request.request.params.get('operation')).toBe('SALE');
    expect(request.request.params.has('amount')).toBe(false);

    request.flush(AVAILABILITY);
    fixture.detectChanges();

    expect(page().availability()).toEqual(AVAILABILITY);
    expect(fixture.nativeElement.querySelector('app-account-panel .account')).not.toBeNull();
  });

  /**
   * Un titular sin cuenta corriente responde 404, y eso **no es un error**: es normal, no le impide
   * vender, y el panel lo dice en vez de quedarse en blanco — «no puede llevar nada» y «no hay a
   * quién preguntarle» no son lo mismo. Si le vende a cuenta, la cuenta se abre en el commit.
   */
  it('un titular sin cuenta lo dice, sin cartel de error', () => {
    create();

    page().cart.setCustomer(CUSTOMER);
    fixture.detectChanges();

    http
      .expectOne((candidate) => candidate.url === availabilityUrl(CUSTOMER.uuid))
      .flush({ errorCode: 'CHECKING_ACCOUNT_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(page().availability()).toBeNull();
    expect(page().availabilityLoading()).toBe(false);
    expect(page().noAccount()).toBe(true);

    const panel = fixture.nativeElement.querySelector('app-account-panel');
    expect(panel.textContent).toContain('checkingAccounts.panel.noAccount');
    // Ni saldo ni límite: no hay nada que afirmar sobre una cuenta que no existe.
    expect(panel.querySelector('.account__figures')).toBeNull();
  });

  /**
   * Cualquier otro error deja el panel en blanco y **no** afirma que no tenga cuenta: decirlo porque
   * el servidor falló sería inventar un dato.
   */
  it('un error que no es 404 no afirma que el titular no tenga cuenta', () => {
    create();

    page().cart.setCustomer(CUSTOMER);
    fixture.detectChanges();

    http
      .expectOne((candidate) => candidate.url === availabilityUrl(CUSTOMER.uuid))
      .flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(page().noAccount()).toBe(false);
    expect(fixture.nativeElement.querySelector('app-account-panel .account')).toBeNull();
  });

  /** Sin cliente no hay a quién preguntarle, y no se pregunta. */
  it('sin cliente no consulta nada', () => {
    create();

    page().cart.setCustomer(null);
    fixture.detectChanges();

    http.expectNone(() => true);
    expect(page().availability()).toBeNull();
  });

  /* ─────────────────────────  La excepción autorizada  ────────────────────────── */

  /**
   * «El flujo de override pide motivo.»
   *
   * El rechazo trae la marca de forzable puesta por el backend; con el permiso, la pantalla abre el
   * diálogo del motivo en vez de informar un error y terminar ahí.
   */
  it('con el permiso, el rechazo por limite abre el dialogo del motivo', () => {
    create([Permissions.checkingAccountOverrideLimit]);

    page().onCommitFailed(LIMIT_REJECTION, { confirmStock: false, accountReason: null });

    expect(openDialog).toHaveBeenCalledOnce();
    expect(openDialog.mock.calls[0][0]).toBe(AccountOverrideDialogComponent);
    // Los números del diálogo salen del detalle del backend, no de la pantalla.
    expect(openDialog.mock.calls[0][1].data.detail.excess).toBe(20000);
  });

  /**
   * Sin el permiso el diálogo **se abre igual**, con el bloque de forzado apagado.
   *
   * Las dos salidas que ofrece —llevar lo que entra a cuenta y cobrar el resto por otro medio— no
   * dependen de ningún permiso, y un «no se puede» a secas manda al cajero a llamar por teléfono sin
   * saber cuánto entra ni qué pedir. Quien decide cuánto se fía de más es otro, y el diálogo lo dice
   * nombrando el permiso.
   */
  it('sin el permiso abre el dialogo igual, con el forzado apagado', () => {
    create();

    page().onCommitFailed(LIMIT_REJECTION, { confirmStock: false, accountReason: null });

    expect(openDialog).toHaveBeenCalledOnce();
    expect(openDialog.mock.calls[0][1].data.canOverride).toBe(false);
  });
});
