import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { User, UserRole } from './models';

const STORAGE_KEY = 'claimshub.session';

interface Session { token: string; expiresAt: string; user: User; }

/**
 * Holds the current session. Token kept in sessionStorage (cleared when the tab closes).
 * Trade-off noted in docs: an httpOnly cookie would be safer against XSS.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);
  private session = signal<Session | null>(this.restore());

  readonly user = computed(() => this.session()?.user ?? null);
  readonly isStaff = computed(() => ['ClaimsOfficer', 'Manager'].includes(this.user()?.role ?? ''));
  readonly isManager = computed(() => this.user()?.role === 'Manager');

  /** Cleanup hooks (e.g. cached photo blobs) run on sign-out. */
  readonly onLogout: (() => void)[] = [];

  get token(): string | null {
    const s = this.session();
    return s && new Date(s.expiresAt) > new Date() ? s.token : null;
  }

  login(email: string, password: string) {
    return this.api.login(email, password).pipe(tap(res => {
      const s: Session = { token: res.token, expiresAt: res.expiresAt, user: res.user };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      this.session.set(s);
    }));
  }

  logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    this.session.set(null);
    this.onLogout.forEach(fn => fn());
    // replaceUrl: the page just left should not be reachable with Back.
    this.router.navigate(['/login'], { replaceUrl: true });
  }

  homeFor(role: UserRole | undefined): string {
    return role === 'Claimant' ? '/claimant' : '/staff';
  }

  private restore(): Session | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Session;
      return new Date(s.expiresAt) > new Date() ? s : null;
    } catch { return null; }
  }
}

/** Attaches the JWT; on 401 the session is dropped and the user sent to login. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token;
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authReq).pipe(catchError(err => {
    if (err.status === 401 && token) auth.logout();
    return throwError(() => err);
  }));
};

/**
 * Route guard by role. UX only — it hides screens a user can't use.
 * The real security boundary is the API (JWT + role policies + ownership checks).
 */
export const roleGuard = (...roles: UserRole[]): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.user();
  if (!user || !auth.token) return router.createUrlTree(['/login']); // no session or it expired
  if (!roles.includes(user.role)) return router.createUrlTree([auth.homeFor(user.role)]);
  return true;
};

/**
 * Login page guard: a signed-in user (e.g. pressing Back after logging in) is sent to their portal
 * instead of seeing the login form again. Only signing out returns you to the login screen.
 */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const user = auth.user();
  return user && auth.token ? inject(Router).createUrlTree([auth.homeFor(user.role)]) : true;
};
