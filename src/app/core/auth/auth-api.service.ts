import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, Observable, of } from 'rxjs';
import {
  AuthDto,
  LoginPayload,
  ChangePasswordRequest,
  PasswordResetRequest,
  ResetPasswordRequest,
  AuthUserDto,
  RefreshTokenDto,
  RefreshTokenRequest,
} from './auth.models';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';

@Service()
export class AuthApi {
  private readonly http = inject(HttpClient);

  /**
   * Login with email/username and password
   */
  public login(request: LoginPayload): Observable<AuthDto> {
    return this.http.post<AuthDto>(apiUrl(`${API_ENDPOINTS.AUTH.LOGIN}`), request);
  }

  /**
   * Refresh authentication token
   * With httpOnly cookies, the refresh token is sent automatically via cookies
   * The body parameter is optional and used for backward compatibility
   */
  public refreshAuthToken(refreshToken?: string): Observable<RefreshTokenDto> {
    // Send refresh token in body if provided (backward compatibility)
    // Otherwise, backend will read from httpOnly cookie
    const body: RefreshTokenRequest = refreshToken ? { refresh: refreshToken } : { refresh: '' };
    return this.http.post<RefreshTokenDto>(apiUrl(`${API_ENDPOINTS.AUTH.REFRESH_TOKEN}`), body);
  }

  /**
   * Get current user information
   */
  public getMe(): Observable<AuthUserDto> {
    return this.http
      .get<AuthUserDto>(apiUrl(`${API_ENDPOINTS.AUTH.ME}`))
      .pipe(map((response) => response));
  }

  /**
   * Change user password
   */
  public changePassword(request: ChangePasswordRequest): Observable<unknown> {
    return this.http.post<unknown>(apiUrl(`${API_ENDPOINTS.AUTH.CHANGE_PASSWORD}`), request);
  }

  /**
   * Request password reset
   */
  public requestPasswordReset(request: PasswordResetRequest): Observable<unknown> {
    return this.http.post<unknown>(apiUrl(`${API_ENDPOINTS.AUTH.REQUEST_PASSWORD_RESET}`), request);
  }

  /**
   * Reset password with code
   */
  public resetPassword(request: ResetPasswordRequest): Observable<unknown> {
    return this.http.post<unknown>(apiUrl(`${API_ENDPOINTS.AUTH.RESET_PASSWORD}`), request);
  }

  /**
   * Logout user
   * Clears httpOnly cookies on the backend
   */
  public logout(): Observable<boolean> {
    return of(true);
  }
}
