import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { GlobalProgressService } from '../progress/global-progress.service';
import { SKIP_GLOBAL_PROGRESS } from './skip-global-progress';

const TRANSLATION_ASSET_PATTERN = /\/i18n\/[^/?#]+\.json(?:[?#]|$)/;

export const globalProgressInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_GLOBAL_PROGRESS) || TRANSLATION_ASSET_PATTERN.test(req.url)) {
    return next(req);
  }

  const progress = inject(GlobalProgressService);
  progress.show();

  return next(req).pipe(finalize(() => progress.hide()));
};
