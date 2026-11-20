import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AppNotification } from '../core/models';
import { NotificationCenter } from '../core/notifications';
import { IconComponent } from '../shared/icon';

/** Staff notification inbox: claimant responses and new photos on claims the officer handles. */
@Component({
  selector: 'app-inbox',
  standalone: true,
  imports: [DatePipe, IconComponent],
  template: `
  <div class="page-head">
    <div>
      <h2>Inbox</h2>
      <p class="muted">Replies and new photos from claimants on claims you handle.</p>
    </div>
    <button (click)="markAll()" [disabled]="unreadCount() === 0">
      <app-icon name="check" [size]="16" /> Mark all as read</button>
  </div>

  <div class="toolbar">
    <div class="segmented" role="group" aria-label="Show">
      <button [attr.aria-pressed]="!unreadOnly()" [class.active]="!unreadOnly()" (click)="unreadOnly.set(false)">All</button>
      <button [attr.aria-pressed]="unreadOnly()" [class.active]="unreadOnly()" (click)="unreadOnly.set(true)">
        Unread @if (unreadCount()) { <span class="pill">{{ unreadCount() }}</span> }</button>
    </div>
  </div>

  @if (error()) { <p class="error"><app-icon name="alert" [size]="15" /> {{ error() }}</p> }

  <div class="card list-card inbox">
    @if (loading()) {
      @for (i of [1, 2, 3]; track i) { <div class="inbox-row skeleton-row"></div> }
    } @else {
      @for (n of visible(); track n.id) {
        <button type="button" class="inbox-row" [class.unread]="!n.isRead" (click)="open(n)">
          <span class="inbox-icon"><app-icon [name]="iconFor(n)" [size]="16" /></span>
          <span class="inbox-text">
            <span class="inbox-message">{{ n.message }}</span>
            <span class="muted small">{{ n.createdAt | date:'d MMM y, HH:mm' }}</span>
          </span>
          @if (!n.isRead) { <span class="unread-dot" aria-label="Unread"></span> }
          <app-icon class="inbox-arrow" name="chevronRight" [size]="16" />
        </button>
      } @empty {
        <div class="empty-state">
          <span class="empty-icon"><app-icon name="inbox" [size]="22" /></span>
          <h3>{{ unreadOnly() ? 'No unread notifications' : 'Nothing here yet' }}</h3>
          <p class="muted">When a claimant answers your question or adds photos, it appears here.</p>
        </div>
      }
    }
  </div>`
})
export class InboxComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  private center = inject(NotificationCenter);

  items = signal<AppNotification[]>([]);
  loading = signal(true);
  error = signal('');
  unreadOnly = signal(false);

  unreadCount = computed(() => this.items().filter(n => !n.isRead).length);
  visible = computed(() => this.unreadOnly() ? this.items().filter(n => !n.isRead) : this.items());

  ngOnInit() { this.load(); }

  load() {
    this.api.notifications().subscribe({
      next: n => { this.items.set(n); this.loading.set(false); },
      error: err => { this.error.set(errorMessage(err)); this.loading.set(false); }
    });
  }

  iconFor(n: AppNotification) {
    return /photo/i.test(n.message) ? 'camera' as const : 'message' as const;
  }

  /** Opening a notification marks it read and goes to the claim. */
  open(n: AppNotification) {
    if (!n.isRead) {
      this.items.update(list => list.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      this.center.unread.update(c => Math.max(0, c - 1));
      this.api.markRead(n.id).subscribe({ error: () => {} });
    }
    this.router.navigate(['/staff/claims', n.claimId]);
  }

  markAll() {
    this.items.update(list => list.map(x => ({ ...x, isRead: true })));
    this.center.unread.set(0);
    this.api.markAllRead().subscribe({ error: err => { this.error.set(errorMessage(err)); this.load(); } });
  }
}
