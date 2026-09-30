import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { ASSEMBLIES_PATH, ASSEMBLY_TRACEABILITY_PATH } from '../../assemblies.paths';
import { AssemblyBackTrace, AssemblyTrace } from '../../data-access/assembly.model';
import { AssembliesApiService } from '../../data-access/assemblies-api.service';

/**
 * La pantalla del recall (wireframe `1u`), en **tres pasos**: dónde se usó el lote del componente,
 * en qué estado quedaron esas unidades y a quién se le vendieron.
 *
 * Los tres juntos y en una pantalla porque son una sola pregunta —«¿a quién llamo?»— y partirla en
 * tres consultas obliga a quien está apurado a encadenarlas a mano.
 *
 * **Es lo que el kit virtual no puede contestar:** en modo virtual la bandeja nunca existió como
 * unidad y no hay nada entre el jamón y el cliente. El camino inverso, del terminado a los lotes que
 * lo formaron, entra en la misma pantalla porque el reclamo puede llegar por cualquiera de las dos
 * puntas.
 */
@Component({
  selector: 'app-assembly-traceability-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
    LocalizedDatePipe,
    PageHeaderComponent,
  ],
  providers: [AssembliesApiService],
  templateUrl: './assembly-traceability.page.html',
  styleUrl: './assembly-traceability.page.css',
})
export class AssemblyTraceabilityPage implements OnInit {
  private readonly api = inject(AssembliesApiService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** El uuid de la partida por la que se pregunta. Llega por la URL o se pega a mano. */
  protected readonly batchUuid = signal('');
  protected readonly loading = signal(false);

  /** Paso 1 a 3: del lote del componente a los clientes. */
  protected readonly trace = signal<AssemblyTrace | null>(null);
  /** El camino inverso: del terminado a los lotes que lo formaron. */
  protected readonly backTrace = signal<AssemblyBackTrace | null>(null);

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.assemblies', link: ASSEMBLIES_PATH },
      { labelKey: 'assemblies.traceability.title', link: ASSEMBLY_TRACEABILITY_PATH },
    ]);
  }

  ngOnInit(): void {
    const component = this.route.snapshot.queryParamMap.get('component');
    const produced = this.route.snapshot.queryParamMap.get('produced');
    if (component) {
      this.batchUuid.set(component);
      this.onTraceComponent();
    } else if (produced) {
      this.batchUuid.set(produced);
      this.onTraceProduced();
    }
  }

  /** La ida: el frigorífico retira el lote y hay que saber a quién llamar. */
  protected onTraceComponent(): void {
    const uuid = this.batchUuid().trim();
    if (!uuid) {
      return;
    }
    this.loading.set(true);
    this.backTrace.set(null);
    this.api
      .traceComponentBatch(uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (trace) => {
          this.loading.set(false);
          this.trace.set(trace);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.trace.set(null);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('assemblies.traceability.error')),
          );
        },
      });
  }

  /** La vuelta: «esta bandeja me cayó mal», y hay que llegar al jamón. */
  protected onTraceProduced(): void {
    const uuid = this.batchUuid().trim();
    if (!uuid) {
      return;
    }
    this.loading.set(true);
    this.trace.set(null);
    this.api
      .traceProducedBatch(uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (trace) => {
          this.loading.set(false);
          this.backTrace.set(trace);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.backTrace.set(null);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('assemblies.traceability.error')),
          );
        },
      });
  }

  protected onBack(): void {
    void this.router.navigate([ASSEMBLIES_PATH]);
  }
}
