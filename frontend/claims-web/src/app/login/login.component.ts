import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth';
import { IconComponent } from '../shared/icon';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
  <div class="login-page">
    <section class="login-intro">
      <span class="brand"><span class="brand-mark"><app-icon name="shield" [size]="16" /></span> ClaimsHub</span>
      <div>
        <h1>Report it once.<br>Follow it to the end.</h1>
        <p>Claimants report incidents with photos from the scene. Claims staff pick them up, assess and decide, in one shared record.</p>
      </div>
      <ul class="intro-points">
        <li><app-icon name="camera" /> Photo evidence attached at the scene</li>
        <li><app-icon name="clock" /> Every step recorded on the claim timeline</li>
        <li><app-icon name="bell" /> Updates as soon as the status changes</li>
      </ul>
    </section>

    <section class="login-panel">
      <form class="login-form" (ngSubmit)="submit()">
        <h2>Sign in</h2>
        <p class="muted">Use your ClaimsHub account.</p>
        <label>Email <input name="email" type="email" [(ngModel)]="email" required autocomplete="username"></label>
        <label>Password <input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password"></label>
        @if (error()) { <p class="error"><app-icon name="alert" [size]="15" /> {{ error() }}</p> }
        <button class="primary block" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>

        <div class="demo">
          <p class="eyebrow">Demo accounts · password Passw0rd!</p>
          @for (d of demo; track d.email) {
            <button type="button" class="demo-row" (click)="email = d.email; password = 'Passw0rd!'">
              <span>{{ d.email }}</span><span class="muted small">{{ d.role }}</span>
            </button>
          }
        </div>
      </form>
    </section>
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
      // replaceUrl: Back from the portal must not land on the login form again.
      next: res => this.router.navigateByUrl(this.auth.homeFor(res.user.role), { replaceUrl: true }),
      error: err => { this.error.set(errorMessage(err)); this.busy.set(false); }
    });
  }
}
