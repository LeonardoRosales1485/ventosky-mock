import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { BranchDto } from '../../../../core/branch/branch.model';
import { BranchChipComponent } from './branch-chip.component';

const CENTRO: BranchDto = { uuid: 'centro', name: 'Centro', active: true };
const NORTE: BranchDto = { uuid: 'norte', name: 'Norte', active: true };

describe('BranchChipComponent', () => {
  let fixture: ComponentFixture<BranchChipComponent>;
  let availableBranches: WritableSignal<BranchDto[] | null>;
  let selectedBranch: WritableSignal<BranchDto | null>;

  const text = (): string => fixture.nativeElement.textContent.trim();

  beforeEach(() => {
    availableBranches = signal<BranchDto[] | null>(null);
    selectedBranch = signal<BranchDto | null>(null);

    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        { provide: AuthService, useValue: { availableBranches, selectedBranch } },
      ],
    });

    fixture = TestBed.createComponent(BranchChipComponent);
  });

  it('names the branch this tab operates in', () => {
    availableBranches.set([CENTRO, NORTE]);
    selectedBranch.set(CENTRO);

    fixture.detectChanges();

    expect(text()).toContain('Centro');
  });

  /** Con una sola sucursal el chip no distingue nada, y la barra tiene lugar de sobra para otra cosa. */
  it('shows nothing when there is a single branch', () => {
    availableBranches.set([CENTRO]);
    selectedBranch.set(CENTRO);

    fixture.detectChanges();

    expect(text()).toBe('');
  });

  /** Antes de que el guard resuelva el listado no hay nada que anunciar. */
  it('shows nothing before the branches resolve', () => {
    fixture.detectChanges();

    expect(text()).toBe('');
  });
});
