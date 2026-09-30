import { Component, input } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { SettingsMenuComponent } from '../../../../shared/components/settings-menu/settings-menu.component';
import { VersionInfoComponent } from '../../../../shared/components/version-info/version-info.component';

@Component({
  selector: 'app-auth-layout',
  imports: [NgOptimizedImage, TranslatePipe, SettingsMenuComponent, VersionInfoComponent],
  templateUrl: './auth-layout.component.html',
  styleUrl: './auth-layout.component.css',
})
export class AuthLayoutComponent {
  readonly titleKey = input.required<string>();
  readonly descriptionKey = input.required<string>();
}
