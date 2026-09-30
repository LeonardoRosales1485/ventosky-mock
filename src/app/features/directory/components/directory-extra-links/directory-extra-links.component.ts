import { Component, input } from '@angular/core';
import { FieldTree } from '@angular/forms/signals';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { BranchDto } from '../../../../core/branch/branch.model';
import { DirectoryLink } from '../../../../core/parties/directory-links';
import { DirectoryPriceListOption } from '../../data-access/directory-catalog-api.service';
import {
  DirectoryFormModel,
  ExtraLinksPlan,
  NO_EXTRA_LINKS,
  reasonsFor,
} from '../../data-access/directory-forms';
import { DirectoryLinkDetection } from '../../data-access/directory-link-detection';
import { DirectoryProfileFieldsComponent } from '../directory-profile-fields/directory-profile-fields.component';

/**
 * «Por los roles que le das, también es transportista: completá sus datos».
 *
 * Lo que una persona es sale de lo que puede hacer. Cuando los roles del bloque de acceso la hacen ser un vínculo
 * que no tiene —el cliente con un rol de reparto—, el formulario pide los datos de ese vínculo, con los mismos
 * campos que su carpeta, y dice qué permisos lo piden. **Son obligatorios**: el backend no guarda un acceso que la
 * ficha no respalda. Los datos de cada vínculo pueden quedar vacíos; lo obligatorio es el vínculo.
 *
 * El formulario que lo contiene detecta y arma el plan (`planExtraLinks`); este componente sólo lo dibuja.
 */
@Component({
  selector: 'app-directory-extra-links',
  imports: [MatIconModule, TranslatePipe, DirectoryProfileFieldsComponent],
  templateUrl: './directory-extra-links.component.html',
  styleUrl: './directory-extra-links.component.css',
})
export class DirectoryExtraLinksComponent {
  readonly form = input.required<FieldTree<DirectoryFormModel>>();
  readonly plan = input<ExtraLinksPlan>(NO_EXTRA_LINKS);
  readonly detection = input.required<DirectoryLinkDetection>();
  readonly branches = input<readonly BranchDto[]>([]);
  readonly priceLists = input<readonly DirectoryPriceListOption[]>([]);

  protected reasons(link: DirectoryLink): readonly string[] {
    return reasonsFor(this.detection().detected, link);
  }
}
