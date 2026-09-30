import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { PickerProduct } from '../../../../core/product-picker/product-picker.model';
import { ProductPickerService } from '../../../../core/product-picker/product-picker.service';
import { WarehouseDto } from '../../../../core/warehouse/warehouse.model';
import { WarehousesApiService } from '../../../../core/warehouse/warehouses-api.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ASSEMBLIES_PATH, DISASSEMBLE_PATH } from '../../assemblies.paths';
import {
  ASSEMBLY_DISASSEMBLE_PERMISSION,
  DisassemblyResult,
} from '../../data-access/assembly.model';
import { AssembliesApiService } from '../../data-access/assemblies-api.service';

/**
 * Desarmar unidades armadas y recuperar sus componentes (§6.9, RN-26).
 *
 * **Es una pantalla aparte y no un botón del listado**, y esa decisión es el contenido: desarmar
 * **no revierte un documento**. Las 3 canastas que se rompen pueden venir de dos armados distintos,
 * así que no hay lotes originales que reconstruir — los componentes reingresan con el costo del kit
 * repartido en la proporción que tuvieron en el armado.
 *
 * Tampoco es una merma, y la pantalla lo dice: si la unidad se rompió o se echó a perder, lo que
 * corresponde es un ajuste de salida con motivo. Confundirlos duplicaría el inventario —los
 * componentes volverían al stock de algo que se tiró—.
 */
@Component({
  selector: 'app-assembly-disassemble-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    PageHeaderComponent,
  ],
  providers: [AssembliesApiService],
  templateUrl: './assembly-disassemble.page.html',
  styleUrl: './assembly-disassemble.page.css',
})
export class AssemblyDisassemblePage implements OnInit {
  private readonly api = inject(AssembliesApiService);
  private readonly warehousesApi = inject(WarehousesApiService);
  private readonly productPicker = inject(ProductPickerService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly canDisassemble = this.auth.hasPermission(ASSEMBLY_DISASSEMBLE_PERMISSION);

  protected readonly product = signal<PickerProduct | null>(null);
  protected readonly quantity = signal<number | null>(1);
  protected readonly observations = signal('');
  protected readonly warehouses = signal<readonly WarehouseDto[]>([]);
  protected readonly warehouseUuid = signal<string | null>(null);

  protected readonly saving = signal(false);
  /** Lo que volvió al stock. Se muestra después de desarmar: es la prueba de que no se perdió valor. */
  protected readonly result = signal<DisassemblyResult | null>(null);

  protected readonly canSubmit = computed(
    () =>
      this.canDisassemble &&
      !this.saving() &&
      this.product() !== null &&
      this.warehouseUuid() !== null &&
      (this.quantity() ?? 0) > 0,
  );

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.assemblies', link: ASSEMBLIES_PATH },
      { labelKey: 'assemblies.disassemble.title', link: DISASSEMBLE_PATH },
    ]);
  }

  ngOnInit(): void {
    this.warehousesApi
      .listAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (warehouses) => {
          this.warehouses.set(warehouses);
          if (!this.warehouseUuid() && warehouses.length > 0) {
            this.warehouseUuid.set(warehouses[0].uuid);
          }
        },
        error: () => this.toast.error(this.translate.instant('assemblies.form.warehousesError')),
      });
  }

  protected onPickProduct(): void {
    this.productPicker
      .pick({
        // El selector no filtra por saldo: quien desarma ya sabe qué tiene en la mano, y ocultar
        // un producto en cero haría parecer que no existe. El faltante lo informa el backend.
        availability: 'any',
        title: this.translate.instant('assemblies.disassemble.pickerTitle'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((picked) => {
        if (!picked) {
          return;
        }
        this.product.set(picked);
        this.result.set(null);
      });
  }

  protected onWarehouseChange(uuid: string): void {
    this.warehouseUuid.set(uuid);
  }

  /**
   * Desarmar saca unidades del stock y devuelve componentes: mueve inventario en las dos
   * direcciones y no se dispara sin confirmación. El diálogo dice **lo que no se puede deshacer**:
   * las unidades rotas no se vuelven a armar solas.
   */
  protected onSubmit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const product = this.product();
    const warehouseUuid = this.warehouseUuid();
    if (!product || !warehouseUuid) {
      return;
    }

    this.confirm
      .confirm({
        title: this.translate.instant('assemblies.disassemble.confirmTitle'),
        message: this.translate.instant('assemblies.disassemble.confirmMessage', {
          quantity: this.quantity() ?? 0,
          product: product.name,
        }),
        confirmLabel: this.translate.instant('assemblies.disassemble.confirm'),
        cancelLabel: this.translate.instant('assemblies.disassemble.cancel'),
        confirmColor: 'warn',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.disassemble(product.uuid, warehouseUuid);
        }
      });
  }

  protected onBack(): void {
    void this.router.navigate([ASSEMBLIES_PATH]);
  }

  private disassemble(productUuid: string, warehouseUuid: string): void {
    this.saving.set(true);
    this.api
      .disassemble({
        product: { uuid: productUuid },
        warehouse: { uuid: warehouseUuid },
        quantity: this.quantity() as number,
        observations: this.observations() || null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.result.set(result);
          this.toast.success(this.translate.instant('assemblies.disassemble.success'));
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('assemblies.disassemble.error')),
          );
        },
      });
  }
}
