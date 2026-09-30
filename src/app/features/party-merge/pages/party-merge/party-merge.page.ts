import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { PartyMergeApiService } from '../../data-access/party-merge-api.service';
import { PartyMergePreviewDto, PartyMergeSideDto } from '../../data-access/party-merge.model';

/** Un documento con los terceros que lo comparten. La pantalla trabaja de a un grupo. */
interface CandidateGroup {
  docNumber: string;
  parties: readonly PartyMergeSideDto[];
}

const MIN_REASON_LENGTH = 5;

/**
 * Fusión manual de terceros duplicados.
 *
 * **Por qué es manual.** Fusionar automáticamente dos terceros que resultaron ser distintos se lleva
 * puestas sus cuentas corrientes, y eso no se deshace. Un documento repetido en dos fichas es un
 * dato, no una conclusión: la pantalla los muestra y una persona decide, caso por caso.
 *
 * **La pantalla muestra todo antes de confirmar** —qué roles se repuntan, cuáles se funden, cuántas
 * operaciones y partidas cambian de dueño y en cuánto queda el saldo— porque después no hay vuelta.
 * El saldo resultante es la suma exacta de los dos: las partidas se mueven, no se recalculan.
 *
 * **El que sobrevive se elige, no se adivina.** Cada candidato muestra su historia —desde cuándo
 * existe, cuántas operaciones tiene, qué saldo—, que es exactamente lo que hace falta para decidir
 * cuál de los dos uuids conviene que siga siendo el que el resto del sistema conoce.
 */
@Component({
  selector: 'app-party-merge-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatRadioModule,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    LoadStateComponent,
    PageHeaderComponent,
  ],
  providers: [PartyMergeApiService],
  templateUrl: './party-merge.page.html',
  styleUrl: './party-merge.page.css',
})
export class PartyMergePage implements OnInit {
  private readonly api = inject(PartyMergeApiService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loadState = signal<LoadState>(LoadState.Idle);
  protected readonly candidates = signal<readonly PartyMergeSideDto[]>([]);

  protected readonly survivorUuid = signal<string | null>(null);
  protected readonly absorbedUuid = signal<string | null>(null);
  protected readonly reason = signal('');
  protected readonly preview = signal<PartyMergePreviewDto | null>(null);
  protected readonly merging = signal(false);

  /** Los candidatos agrupados por documento: es como se leen, de a duplicado. */
  protected readonly groups = computed<readonly CandidateGroup[]>(() => {
    const byDoc = new Map<string, PartyMergeSideDto[]>();
    for (const candidate of this.candidates()) {
      const key = candidate.docNumber ?? '';
      const group = byDoc.get(key);
      if (group) {
        group.push(candidate);
      } else {
        byDoc.set(key, [candidate]);
      }
    }
    return [...byDoc.entries()].map(([docNumber, parties]) => ({ docNumber, parties }));
  });

  protected readonly canPreview = computed(
    () =>
      !!this.survivorUuid() && !!this.absorbedUuid() && this.survivorUuid() !== this.absorbedUuid(),
  );

  protected readonly canMerge = computed(
    () => !!this.preview() && this.reason().trim().length >= MIN_REASON_LENGTH && !this.merging(),
  );

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'partyMerge.title' },
    ]);
  }

  ngOnInit(): void {
    this.load();
  }

  protected onRetry(): void {
    this.load();
  }

  /** Elegir uno de los dos lados descarta la previa: hablaba de otra pareja. */
  protected onPickSurvivor(uuid: string): void {
    this.survivorUuid.set(uuid);
    this.preview.set(null);
  }

  protected onPickAbsorbed(uuid: string): void {
    this.absorbedUuid.set(uuid);
    this.preview.set(null);
  }

  protected onPreview(): void {
    if (!this.canPreview()) {
      return;
    }
    this.api
      .preview({ survivorUuid: this.survivorUuid()!, absorbedUuid: this.absorbedUuid()! })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => this.preview.set(preview),
        error: () => {
          this.preview.set(null);
          this.toast.error(this.translate.instant('partyMerge.errors.preview'));
        },
      });
  }

  /**
   * Fusiona.
   *
   * Después de fusionar se recarga la lista y se limpia la selección: el absorbido dejó de existir
   * como candidato, y dejar la pantalla como estaba invitaría a fusionarlo de nuevo.
   */
  protected onMerge(): void {
    if (!this.canMerge()) {
      return;
    }
    this.merging.set(true);
    this.api
      .execute({
        survivorUuid: this.survivorUuid()!,
        absorbedUuid: this.absorbedUuid()!,
        reason: this.reason().trim(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.merging.set(false);
          this.toast.success(this.translate.instant('partyMerge.merged'));
          this.reset();
          this.load();
        },
        error: (error: unknown) => {
          this.merging.set(false);
          this.toast.error(
            error instanceof Error && error.message
              ? error.message
              : this.translate.instant('partyMerge.errors.merge'),
          );
        },
      });
  }

  private reset(): void {
    this.survivorUuid.set(null);
    this.absorbedUuid.set(null);
    this.reason.set('');
    this.preview.set(null);
  }

  private load(): void {
    this.loadState.set(LoadState.Loading);
    this.api
      .candidates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (candidates) => {
          this.candidates.set(candidates);
          this.loadState.set(LoadState.Success);
        },
        error: () => {
          this.candidates.set([]);
          this.loadState.set(LoadState.Error);
        },
      });
  }
}
