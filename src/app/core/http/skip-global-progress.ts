import { HttpContext, HttpContextToken } from '@angular/common/http';

/** When `true`, the global progress interceptor ignores the request. */
export const SKIP_GLOBAL_PROGRESS = new HttpContextToken<boolean>(() => false);

/** Builds an `HttpContext` that opts the request out of the global progress bar. */
export function skipGlobalProgress(): HttpContext {
  return new HttpContext().set(SKIP_GLOBAL_PROGRESS, true);
}
