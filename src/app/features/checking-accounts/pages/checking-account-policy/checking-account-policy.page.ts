import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatDialog } from '@angular/material/dialog';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { CHECKING_ACCOUNTS_PATH } from '../../checking-accounts.paths';
import {
  PolicyPreviewDialogComponent,
  PolicyPreviewDialogData,
  PolicyPreviewDialogResult,
} from '../../components/policy-preview-dialog/policy-preview-dialog.component';
import {
  CheckingAccountPolicyDto,
  PolicyPreviewDto,
  PolicyReprocessDto,
  PolicyValueSource,
  SaveCompanyPolicyRequest,
} from '../../data-access/checking-account-policy.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';

/**
 * La política de cuenta corriente de la empresa: los tres parámetros que rigen para todos sus
 * titulares, salvo los que tengan override propio.
 *
 * **La pantalla no calcula nada.** El disponible, las cuentas que quedarían excedidas y los números
 * del reproceso los contesta el backend con las mismas funciones que después ejecutan el cambio. Si
 * los estimara acá, el día que cambie una regla habría dos versiones de la verdad y la pantalla
 * prometería algo que el guardado no cumple.
 *
 * Tres decisiones que se ven en la forma:
 *
 * - **Bajar el límite avisa, no bloquea.** El límite gobierna operaciones nuevas y no reescribe el
 *   pasado: las cuentas que ya están por encima siguen exactamente como están. Pero enterarse
 *   después —cuando el mostrador empieza a rebotar ventas que ayer entraban— es lo que hay que
 *   evitar.
 * - **Pasar a automático muestra la previa y después el resultado**, y los dos números coinciden
 *   porque salen del mismo reparto.
 * - **Qué consecuencias tiene el guardado lo decide el backend, no la pantalla.** La previa dice si
 *   hay reproceso y cuántas cuentas quedarían excedidas; inferirlo acá comparando lo viejo con lo
 *   nuevo sería una segunda implementación de la misma regla.
 * - **El límite se presenta como lo que es: un tope de venta.** La pantalla dice explícitamente que
 *   en compras no se valida — mostrar un tope sin aclarar que no aplica a las dos mitades es peor
 *   que no mostrarlo.
 *
 * Lo que **no** hay, y no es un olvido: umbrales de morosidad y cantidad máxima de comprobantes
 * abiertos. Los dos se cayeron con el análisis —el nivel de morosidad lo fija una persona y no hace
 * nada, y ese límite no existe—, así que un campo para ellos sería una promesa vacía.
 */
@Component({
  selector: 'app-checking-account-policy-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
  ],
  templateUrl: './checking-account-policy.page.html',
  styleUrl: './checking-account-policy.page.css',
})
export class CheckingAccountPolicyPage implements OnInit {
  private readonly api = inject(CheckingAccountsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly breadcrumb = inject(BreadcrumbService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly checking = signal(false);

  /** Lo que está guardado. Es contra esto que se compara para saber si hay algo que avisar. */
  protected readonly saved = signal<CheckingAccountPolicyDto | null>(null);

  protected readonly dueDays = signal<number | null>(null);
  /** El modo del tope: la pantalla lo pregunta antes que el importe, porque son tres respuestas. */
  protected readonly limitMode = signal<'UNLIMITED' | 'AMOUNT'>('UNLIMITED');
  protected readonly debtLimit = signal<number | null>(null);
  protected readonly allocationMode = signal<'AUTOMATIC' | 'MANUAL'>('AUTOMATIC');

  /** Lo que el backend contestó sobre lo que se está por guardar. Se pide antes de confirmar. */
  protected readonly preview = signal<PolicyPreviewDto | null>(null);
  /** Lo que el backend hizo al guardar. Se muestra hasta que se toque algo. */
  protected readonly result = signal<PolicyReprocessDto | null>(null);

  /**
   * Si lo que hay en pantalla difiere de lo guardado. Sin esto el botón de guardar estaría siempre
   * activo y la previa se pediría por nada.
   */
  protected readonly dirty = computed(() => {
    const current = this.saved();
    if (!current) {
      return false;
    }
    return (
      this.dueDays() !== current.resolved.dueDays ||
      this.debtLimitValue() !== current.resolved.debtLimit ||
      this.allocationMode() !== current.resolved.allocationMode
    );
  });

  protected readonly dueDaysChanged = computed(
    () => !!this.saved() && this.dueDays() !== this.saved()!.resolved.dueDays,
  );

  protected readonly limitChanged = computed(
    () => !!this.saved() && this.debtLimitValue() !== this.saved()!.resolved.debtLimit,
  );

  protected readonly allocationChanged = computed(
    () => !!this.saved() && this.allocationMode() !== this.saved()!.resolved.allocationMode,
  );

  /**
   * Cuántas **declaraciones** difieren de lo guardado.
   *
   * Se cuentan parámetro por parámetro y no como un booleano de «hay cambios»: cada uno que cambie
   * deja su propia fila en el extracto de las cuentas, con la declaración anterior y la nueva.
   */
  protected readonly changedCount = computed(
    () =>
      (this.dueDaysChanged() ? 1 : 0) +
      (this.limitChanged() ? 1 : 0) +
      (this.allocationChanged() ? 1 : 0),
  );

  /** El tope que se está proponiendo: `null` es «sin tope», que es una decisión y no un vacío. */
  protected readonly debtLimitValue = computed<number | null>(() =>
    this.limitMode() === 'AMOUNT' ? (this.debtLimit() ?? null) : null,
  );

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.checkingAccounts', link: CHECKING_ACCOUNTS_PATH },
      { labelKey: 'nav.items.checkingAccountPolicy' },
    ]);
  }

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.api.getCompanyPolicy().subscribe({
      next: (policy) => {
        this.applyToForm(policy);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error(this.translate.instant('checkingAccounts.companyPolicy.errors.load'));
      },
    });
  }

  /**
   * Pide al backend qué pasaría, y sólo entonces muestra los avisos.
   *
   * Es un paso explícito y no algo que corra mientras se tipea: contar cuentas excedidas recorre la
   * empresa entera, y hacerlo en cada tecla sería castigar a la base por un cartel.
   */
  protected check(): void {
    this.checking.set(true);
    this.result.set(null);
    this.api.previewCompanyPolicy(this.buildRequest()).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.checking.set(false);
        this.openPreview(preview);
      },
      error: () => {
        this.checking.set(false);
        this.toast.error(this.translate.instant('checkingAccounts.companyPolicy.errors.preview'));
      },
    });
  }

  /**
   * Los dos bloques —el reproceso y las cuentas que quedarían excedidas— en un solo diálogo, porque
   * quien configura toma **una** decisión: guardar o no, y necesita los dos para tomarla.
   */
  private openPreview(preview: PolicyPreviewDto): void {
    this.dialog
      .open<PolicyPreviewDialogComponent, PolicyPreviewDialogData, PolicyPreviewDialogResult>(
        PolicyPreviewDialogComponent,
        { data: { preview }, width: '40rem', maxWidth: '95vw' },
      )
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) {
          this.save();
        }
      });
  }

  /** Descartar vuelve a lo guardado, sin pedir nada: no se escribió nada que deshacer. */
  protected onDiscard(): void {
    const current = this.saved();
    if (current) {
      this.applyToForm(current);
      this.result.set(null);
    }
  }

  /** «Sin tope» es una decisión y no un vacío, así que se dice con palabras y no con un guion. */
  protected limitLabel(value: number | null): string {
    return value === null
      ? this.translate.instant('checkingAccounts.companyPolicy.limit.unlimited')
      : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
  }

  protected save(): void {
    this.saving.set(true);
    this.api.saveCompanyPolicy(this.buildRequest()).subscribe({
      next: (policy) => {
        this.applyToForm(policy);
        // El resumen del reproceso viene en la respuesta del propio guardado: sin eso habría que
        // releer, y entre las dos llamadas la pantalla mostraría el valor que se acaba de pisar.
        this.result.set(policy.reprocess);
        this.saving.set(false);
        this.toast.success(this.translate.instant('checkingAccounts.companyPolicy.saved'));
      },
      error: () => {
        this.saving.set(false);
        this.toast.error(this.translate.instant('checkingAccounts.companyPolicy.errors.save'));
      },
    });
  }

  /** Cualquier cambio invalida la previa: mostrarla al lado de otros valores sería mentir. */
  protected onFormChange(): void {
    this.preview.set(null);
    this.result.set(null);
  }

  protected sourceLabel(source: PolicyValueSource): string {
    return `checkingAccounts.companyPolicy.sources.${source}`;
  }

  private buildRequest(): SaveCompanyPolicyRequest {
    return {
      // La política de la empresa **nunca hereda**: es el peldaño más alto y no tiene de quién. Por
      // eso los modos son siempre explícitos y `INHERIT` no es una opción de esta pantalla.
      dueDaysMode: 'VALUE',
      dueDays: this.dueDays() ?? 0,
      debtLimitMode: this.limitMode(),
      debtLimitAmount: this.limitMode() === 'AMOUNT' ? this.debtLimit() : null,
      allocationMode: this.allocationMode(),
    };
  }

  private applyToForm(policy: CheckingAccountPolicyDto): void {
    this.saved.set(policy);
    this.dueDays.set(policy.resolved.dueDays);
    this.limitMode.set(policy.resolved.debtLimit === null ? 'UNLIMITED' : 'AMOUNT');
    this.debtLimit.set(policy.resolved.debtLimit);
    this.allocationMode.set(policy.resolved.allocationMode);
    this.preview.set(null);
  }
}
