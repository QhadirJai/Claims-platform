import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth';
import { IconComponent } from './shared/icon';

const ROLE_LABEL: Record<string, string> = { Claimant: 'Claimant', ClaimsOfficer: 'Claims officer', Manager: 'Manager' };

/** One shell for both portals: sidebar on desktop, compact top bar on phones. */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
  @if (auth.user(); as u) {
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" [routerLink]="auth.homeFor(u.role)">
          <span class="brand-mark"><app-icon name="shield" [size]="16" /></span><span class="brand-name">ClaimsHub</span>
        </a>
        <nav class="side-nav">
          @if (auth.isStaff()) {
            <a routerLink="/staff" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" aria-label="Queue">
              <app-icon name="inbox" /><span class="nav-label">Queue</span></a>
            <a routerLink="/staff/dashboard" routerLinkActive="active" aria-label="Dashboard">
              <app-icon name="chart" /><span class="nav-label">Dashboard</span></a>
          } @else {
            <a routerLink="/claimant" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" aria-label="My claims">
              <app-icon name="file" /><span class="nav-label">My claims</span></a>
            <a routerLink="/claimant/new" routerLinkActive="active" aria-label="Report incident">
              <app-icon name="plus" /><span class="nav-label">Report incident</span></a>
          }
        </nav>
        <div class="side-user">
          <span class="avatar">{{ initials() }}</span>
          <span class="who"><strong>{{ u.fullName }}</strong><span class="muted small">{{ role() }}</span></span>
          <button class="icon-btn" (click)="auth.logout()" aria-label="Sign out" title="Sign out"><app-icon name="logout" /></button>
        </div>
      </aside>
      <main class="main"><router-outlet /></main>
    </div>
  } @else {
    <router-outlet />
  }`
})
export class AppComponent {
  auth = inject(AuthService);
  initials = computed(() => (this.auth.user()?.fullName ?? '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase());
  role = computed(() => ROLE_LABEL[this.auth.user()?.role ?? ''] ?? '');
}
