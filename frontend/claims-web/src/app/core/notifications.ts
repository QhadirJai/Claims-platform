import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth';

const POLL_MS = 30_000;

/**
 * Unread notification count for the signed-in user.
 * Notifications are written asynchronously by the Kafka worker, so the count is refreshed
 * on every navigation and polled every 30 s while the tab is visible. A cheap count query
 * keeps that affordable; live push (SSE/SignalR) is the documented next step.
 */
@Injectable({ providedIn: 'root' })
export class NotificationCenter {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  readonly unread = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const router = inject(Router);
    const sub = router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.refresh());
    inject(DestroyRef).onDestroy(() => { sub.unsubscribe(); this.stop(); });

    // Poll only while signed in.
    effect(() => {
      if (this.auth.user()) this.start(); else this.stop();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
  }

  refresh() {
    if (!this.auth.token || document.hidden) return;
    this.api.unreadCount().subscribe({ next: r => this.unread.set(r.count), error: () => {} });
  }

  private start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_MS);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unread.set(0);
  }
}
