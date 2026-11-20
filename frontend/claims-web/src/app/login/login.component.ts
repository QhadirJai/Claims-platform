import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
  <div class="login-wrap">
    <form class="card login" (ngSubmit)="submit()">
      <h1>ClaimsHub</h1>
      <p class="muted">Sign in to report or manage claims.</p>
      <label>Email <input name="email" type="email" [(ngModel)]="email" required autocomplete="username"></label>
      <label>Password <input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password"></label>
      @if (error()) { <p class="error">{{ error() }}</p> }
      <button class="primary" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>

      <details class="demo">
        <summary>Demo accounts (password: Passw0rd!)</summary>
        @for (d of demo; track d.email) {
          <button type="button" class="link" (click)="email = d.email; password = 'Passw0rd!'">{{ d.email }}</button>
          <span class="muted"> — {{ d.role }}</span><br>
        }
      </details>
    </form>
  </div>`
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  busy = signal(false);
  error = signal('');

  demo = [
    { email: 'alice@demo.local', role: 'Claimant' },
    { email: 'ben@demo.local', role: 'Claimant' },
    { email: 'olivia@demo.local', role: 'Claims officer' },
    { email: 'oscar@demo.local', role: 'Claims officer' },
    { email: 'maya@demo.local', role: 'Manager' }
  ];

  submit() {
    this.busy.set(true);
    this.error.set('');
    this.auth.login(this.email, this.password).subscribe({
      next: res => this.router.navigateByUrl(this.auth.homeFor(res.user.role)),
      error: err => { this.error.set(errorMessage(err)); this.busy.set(false); }
    });
  }
}
