import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../notifications/toast.service';
import { PartiesApiService } from '../parties-api.service';
import {
  PARTY_CONTACT_TYPES,
  PartyContactDto,
  PartyContactType,
} from '../party.model';

/**
 * ABM de contactos del tercero.
 *
 * Cuelga de la **identidad**, no del rol: la dirección de administración del tercero es la misma nos
 * compre o nos venda, así que la ficha de cliente y la de proveedor del mismo tercero muestran los
 * mismos contactos.
 *
 * El principal es **por tipo**. Con un único principal por tercero, alguien marca el teléfono y los
 * avisos por mail se quedan sin destino sin que nada falle — el peor modo de error, el silencioso.
 * El backend lo garantiza: promueve solo al primero de su tipo y baja al anterior cuando entra otro.
 */
@Component({
  selector: 'app-party-contacts-editor',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
  ],
  templateUrl: './party-contacts-editor.component.html',
  styleUrl: './party-contacts-editor.component.css',
})
export class PartyContactsEditorComponent {
  /** Identidad cuyos contactos se administran. Vacío mientras el tercero no exista todavía. */
  readonly partyUuid = input.required<string | null>();

  private readonly partiesApi = inject(PartiesApiService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly contactTypes = PARTY_CONTACT_TYPES;
  protected readonly contacts = signal<PartyContactDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  protected readonly draftType = signal<PartyContactType>('EMAIL');
  protected readonly draftValue = signal('');
  protected readonly draftLabel = signal('');
  protected readonly draftPrincipal = signal(false);

  protected readonly canAdd = computed(
    () => !!this.partyUuid() && this.draftValue().trim().length > 0 && !this.saving(),
  );

  constructor() {
    effect(() => {
      const uuid = this.partyUuid();
      if (!uuid) {
        this.contacts.set([]);
        return;
      }
      this.load(uuid);
    });
  }

  protected onAdd(): void {
    const uuid = this.partyUuid();
    if (!uuid || !this.canAdd()) {
      return;
    }
    this.saving.set(true);
    this.partiesApi
      .saveContact({
        partyUuid: uuid,
        type: this.draftType(),
        value: this.draftValue().trim(),
        label: this.draftLabel().trim() || null,
        isPrincipal: this.draftPrincipal(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.draftValue.set('');
          this.draftLabel.set('');
          this.draftPrincipal.set(false);
          this.saving.set(false);
          this.load(uuid);
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(this.translate.instant('parties.contacts.saveError'));
        },
      });
  }

  /** Marcar principal baja al anterior de ese tipo; el backend es el que lo garantiza. */
  protected onMakePrincipal(contact: PartyContactDto): void {
    const uuid = this.partyUuid();
    if (!uuid || contact.isPrincipal) {
      return;
    }
    this.saving.set(true);
    this.partiesApi
      .saveContact({
        uuid: contact.uuid,
        partyUuid: uuid,
        type: contact.type,
        value: contact.value,
        label: contact.label ?? null,
        isPrincipal: true,
        version: contact.version,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.load(uuid);
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(this.translate.instant('parties.contacts.saveError'));
        },
      });
  }

  protected onDelete(contact: PartyContactDto): void {
    const uuid = this.partyUuid();
    if (!uuid) {
      return;
    }
    this.saving.set(true);
    this.partiesApi
      .deleteContact(contact.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.load(uuid);
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(this.translate.instant('parties.contacts.deleteError'));
        },
      });
  }

  private load(partyUuid: string): void {
    this.loading.set(true);
    this.partiesApi
      .listContacts(partyUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (contacts) => {
          this.contacts.set(contacts ?? []);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast.error(this.translate.instant('parties.contacts.loadError'));
        },
      });
  }
}
