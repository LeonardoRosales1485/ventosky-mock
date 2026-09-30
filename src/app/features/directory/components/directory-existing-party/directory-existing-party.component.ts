import { Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../../core/i18n/language.service';
import { DirectoryLink, isEmployeeSpecialty } from '../../../../core/parties/directory-links';
import { formatDocument } from '../../../../core/parties/party.model';
import { ExistingPartyDecision } from '../../data-access/directory-forms';

/**
 * «Si ese documento ya está cargado». Cuando el documento tipeado es de una ficha de la empresa, el alta no
 * crea otra: ofrece sumarle el vínculo que falta, o abrir la que ya lo tiene.
 *
 * **Lo que se acababa de tipear no pisa la identidad existente.** Nombre y contactos los cargó alguien más, y
 * pisarlos sin confirmación es perder datos de otro: aceptar deja la ficha como estaba y el formulario pide
 * sólo los campos del vínculo.
 */
@Component({
  selector: 'app-directory-existing-party',
  imports: [MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <section class="existing" role="status">
      <h3 class="existing__title">{{ 'directory.existing.title' | translate }}</h3>

      @if (accepted()) {
        <p>{{ acceptedText() }}</p>
        <div class="existing__actions">
          <button mat-button type="button" (click)="resetRequested.emit()">
            {{ 'directory.existing.reset' | translate }}
          </button>
        </div>
      } @else {
        <p>{{ message() }}</p>
        @if (document(); as doc) {
          <p class="existing__document">{{ doc }}</p>
        }
        <div class="existing__actions">
          @if (decision().kind !== 'open') {
            <button mat-flat-button type="button" (click)="acceptRequested.emit()">
              {{ 'directory.existing.accept' | translate: { link: linkNoun() } }}
            </button>
          }
          @if (canOpen()) {
            <button mat-stroked-button type="button" (click)="openRequested.emit()">
              {{ 'directory.existing.open' | translate }}
            </button>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .existing {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.75rem;
      background: var(--mat-sys-surface-container-low);
      font-size: 0.875rem;
    }

    .existing__title {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 600;
    }

    .existing p {
      margin: 0;
    }

    .existing__document {
      color: var(--mat-sys-on-surface-variant);
      font-variant-numeric: tabular-nums;
    }

    .existing__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  `,
})
export class DirectoryExistingPartyComponent {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  readonly link = input.required<DirectoryLink>();
  readonly decision = input.required<ExistingPartyDecision>();
  /** El operador ya eligió sumarle el vínculo: el bloque lo recuerda y ofrece volver atrás. */
  readonly accepted = input(false);

  readonly acceptRequested = output<void>();
  readonly openRequested = output<void>();
  readonly resetRequested = output<void>();

  protected readonly linkNoun = computed(() => {
    this.language.currentLang();
    return this.translate.instant(`directory.linkNouns.${this.link()}`);
  });

  protected readonly document = computed(() => {
    const party = this.decision().party;
    return party.docNumber ? formatDocument(party) : null;
  });

  /**
   * «Ver su ficha» abre la que ya tiene este vínculo o, si es para sumarle uno, alguna de las que ya tiene. Una
   * ficha que no se pudo leer —quien carga empleados no siempre puede ver el maestro— no tiene cuál abrir.
   */
  protected readonly canOpen = computed(() => {
    const decision = this.decision();
    if (decision.kind !== 'addLink') {
      return true;
    }
    return (decision.party.roles ?? []).length > 0;
  });

  protected readonly message = computed(() => {
    this.language.currentLang();
    const decision = this.decision();
    const name = decision.party.name;
    const link = this.linkNoun();

    if (decision.kind === 'open') {
      return name
        ? this.translate.instant('directory.existing.alreadyLinked', { name, link })
        : this.translate.instant('directory.existing.alreadyLinkedUnnamed', { link });
    }

    if (decision.kind === 'addSpecialty') {
      const specialties = decision.specialties
        .filter(isEmployeeSpecialty)
        .map((specialty) => this.translate.instant(`directory.linkNouns.${specialty}`))
        .join(', ');
      return this.translate.instant(
        specialties ? 'directory.existing.addSpecialty' : 'directory.existing.addSpecialtyBare',
        { name: name || '—', link, specialties },
      );
    }

    if (!name) {
      return this.translate.instant('directory.existing.addLinkUnnamed', { link });
    }
    const roles = (decision.party.roles ?? [])
      .map((role) => this.translate.instant(`parties.roles.${role.role}`))
      .join(', ');
    return this.translate.instant(
      roles ? 'directory.existing.addLink' : 'directory.existing.addLinkBare',
      { name, link, roles },
    );
  });

  protected readonly acceptedText = computed(() => {
    this.language.currentLang();
    const name = this.decision().party.name;
    return name
      ? this.translate.instant('directory.existing.accepted', { name, link: this.linkNoun() })
      : this.translate.instant('directory.existing.acceptedUnnamed', { link: this.linkNoun() });
  });
}
