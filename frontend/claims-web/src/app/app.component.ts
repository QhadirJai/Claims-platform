import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  @if (auth.user(); as u) {
    <header class="topbar">
      <a class="brand" [routerLink]="auth.homeFor(u.role)">ClaimsHub</a>
      <nav>
        @if (auth.isStaff()) {
          <a routerLink="/staff" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Queue</a>
          <a routerLink="/staff/dashboard" routerLinkActive="active">Dashboard</a>
        } @else {
          <a routerLink="/claimant" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">My claims</a>
          <a routerLink="/claimant/new" routerLinkActive="active">Report incident</a>
        }
      </nav>
      <div class="who">
        <span>{{ u.fullName }} <span class="role">{{ u.role }}</span></span>
        <button class="link" (click)="auth.logout()">Sign out</button>
      </div>
    </header>
  }
  <main [class.wide]="auth.isStaff()"><router-outlet /></main>`
})
export class AppComponent {
  auth = inject(AuthService);
}
