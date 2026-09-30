import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { BranchesApiService } from '../../../../core/branch/branches-api.service';
import { BranchDto } from '../../../../core/branch/branch.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import { AuthLayoutComponent } from '../../components/auth-layout/auth-layout.component';
import {
  BranchFormDialogComponent,
  BranchFormDialogResult,
} from '../../components/branch-form-dialog/branch-form-dialog.component';

@Component({
  selector: 'app-select-branch-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    TranslatePipe,
    AuthLayoutComponent,
  ],
  templateUrl: './select-branch.page.html',
  styleUrl: './select-branch.page.css',
})
export class SelectBranchPage {
  private readonly authService = inject(AuthService);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly branches = computed(() => this.authService.availableBranches() ?? []);
  protected readonly canCreate = computed(() => this.authService.canCreateBranch());
  protected readonly creating = signal(false);

  protected selectBranch(branch: BranchDto): void {
    this.authService.selectBranch(branch.uuid);
  }

  protected openCreateDialog(): void {
    const ref = this.dialog.open<
      BranchFormDialogComponent,
      undefined,
      BranchFormDialogResult
    >(BranchFormDialogComponent, {
      width: '420px',
      autoFocus: 'first-tabbable',
    });

    ref
      .afterClosed()
      .pipe(
        filter((result): result is BranchFormDialogResult => isBranchFormResult(result)),
        switchMap((result) => {
          this.creating.set(true);
          return this.branchesApi.save({
            name: result.name,
            active: result.active,
            // El alta de onboarding sólo pide el nombre: el domicilio —que imprime el remito de
            // traslado— se carga después, desde Sucursales, cuando ya hay con qué operar.
            address: null,
          });
        }),
      )
      .subscribe({
        next: (branch) => {
          this.creating.set(false);
          this.authService.selectCreatedBranch(branch);
        },
        error: () => {
          this.creating.set(false);
          this.toast.error(this.translate.instant('auth.selectBranch.createError'));
        },
      });
  }
}

function isBranchFormResult(value: unknown): value is BranchFormDialogResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const result = value as BranchFormDialogResult;
  return typeof result.name === 'string' && typeof result.active === 'boolean';
}
