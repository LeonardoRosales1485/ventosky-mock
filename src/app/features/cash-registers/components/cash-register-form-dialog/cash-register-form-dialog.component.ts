import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { form, FormField, maxLength, required, submit } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { BranchDto } from '../../../../core/branch/branch.model';
import { BranchesApiService } from '../../../../core/branch/branches-api.service';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import {
  CashRegisterDto,
  CashRegisterUserOption,
  hasOpenSession,
} from '../../data-access/cash-register.model';
import { CashRegistersApiService } from '../../data-access/cash-registers-api.service';

export interface CashRegisterFormDialogData {
  cashRegister: CashRegisterDto | null;
  /** Sucursal que viene preseleccionada en el alta (la del filtro del listado, si hay). */
  defaultBranchUuid?: string | null;
}

export interface CashRegisterFormDialogResult {
  uuid?: string;
  name: string;
  active: boolean;
  branchUuid: string;
  /** Lista completa de preasignados: vacía significa «quitá todas», no «no toques nada». */
  assignedUserUuids: string[];
  /**
   * Versión que traía la caja al abrir el diálogo, para que el guardado la reenvíe y el backend
   * pueda detectar si alguien más la editó mientras tanto. Ausente en un alta.
   */
  version?: number;
}

interface CashRegisterFormModel {
  name: string;
  active: boolean;
  branchUuid: string;
  assignedUserUuids: string[];
}

const NAME_MAX_LENGTH = 255;

/**
 * Alta y edición de una caja, con su preasignación de usuarios.
 *
 * Los dos catálogos que necesita —sucursales y usuarios— se cargan juntos: sin ellos el formulario
 * no se puede completar, así que se muestra un estado de carga en vez de un select vacío.
 */
@Component({
  selector: 'app-cash-register-form-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
    LoadStateComponent,
  ],
  providers: [CashRegistersApiService],
  templateUrl: './cash-register-form-dialog.component.html',
  styleUrl: './cash-register-form-dialog.component.css',
})
export class CashRegisterFormDialogComponent implements OnInit {
  private readonly dialogRef = inject(
    MatDialogRef<CashRegisterFormDialogComponent, CashRegisterFormDialogResult>,
  );
  private readonly data = inject<CashRegisterFormDialogData>(MAT_DIALOG_DATA);
  private readonly cashRegistersApi = inject(CashRegistersApiService);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly LoadState = LoadState;
  protected readonly isEdit = this.data.cashRegister !== null;
  /** Con la caja abierta se puede seguir editando, pero mover la sucursal sí sería incoherente. */
  protected readonly isOpen = this.data.cashRegister
    ? hasOpenSession(this.data.cashRegister)
    : false;

  protected readonly catalogsState = signal(LoadState.Loading);
  protected readonly branches = signal<readonly BranchDto[]>([]);
  protected readonly users = signal<readonly CashRegisterUserOption[]>([]);

  private readonly model = signal<CashRegisterFormModel>({
    name: this.data.cashRegister?.name ?? '',
    active: this.data.cashRegister?.active ?? true,
    branchUuid: this.data.cashRegister?.branch?.uuid ?? this.data.defaultBranchUuid ?? '',
    assignedUserUuids: (this.data.cashRegister?.assignedUsers ?? []).map((user) => user.uuid),
  });

  protected readonly cashRegisterForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);
    required(path.branchUuid);
  });

  /** Cambiar de sucursal reubica las preasignaciones, así que conviene decirlo antes de guardar. */
  protected readonly branchChanged = computed(
    () =>
      this.isEdit &&
      !!this.data.cashRegister?.branch?.uuid &&
      this.cashRegisterForm.branchUuid().value() !== this.data.cashRegister.branch.uuid,
  );

  ngOnInit(): void {
    this.loadCatalogs();
  }

  protected loadCatalogs(): void {
    this.catalogsState.set(LoadState.Loading);

    forkJoin({
      branches: this.branchesApi.listAll(),
      users: this.cashRegistersApi.listUsers(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ branches, users }) => {
          this.branches.set(branches);
          this.users.set(users);
          this.catalogsState.set(branches.length > 0 ? LoadState.Success : LoadState.Idle);
        },
        error: () => {
          this.branches.set([]);
          this.users.set([]);
          this.catalogsState.set(LoadState.Error);
        },
      });
  }

  protected onActiveChange(checked: boolean): void {
    this.cashRegisterForm.active().value.set(checked);
  }

  protected onBranchChange(uuid: string): void {
    this.cashRegisterForm.branchUuid().value.set(uuid);
  }

  protected onAssignedUsersChange(uuids: string[]): void {
    this.cashRegisterForm.assignedUserUuids().value.set(uuids);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.cashRegisterForm().invalid()) {
      this.cashRegisterForm().markAsTouched();
      return;
    }

    void submit(this.cashRegisterForm, async () => {
      const value = this.model();
      const name = value.name.trim();

      if (!name || !value.branchUuid) {
        return;
      }

      this.dialogRef.close({
        uuid: this.data.cashRegister?.uuid,
        name,
        active: value.active,
        branchUuid: value.branchUuid,
        assignedUserUuids: value.assignedUserUuids,
        version: this.data.cashRegister?.version,
      });
    });
  }
}
