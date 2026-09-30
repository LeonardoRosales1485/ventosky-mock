import { HttpContextToken } from '@angular/common/http';

/** Marks a request that already retried once after a successful token refresh. */
export const RETRIED_AFTER_REFRESH = new HttpContextToken<boolean>(() => false);
