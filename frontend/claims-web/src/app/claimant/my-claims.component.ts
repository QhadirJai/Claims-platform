import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth';
import { AppNotification, ClaimSummary } from '../core/models';
import { IconComponent } from '../shared/icon';
import { ClaimTypeComponent, StatusBadgeComponent } from '../shared/ui';

@Component({
  selector: 'app-my-claims',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, StatusBadgeComponent, ClaimTypeComponent, IconComponent],
  template: `
  <div class="page-head">
    <div>
      <p class="eyebrow">Hello, {{ firstName() }}</p>
      <h2>My claims</h2>
    </div>
    <a class="button primary" routerLink="/claimant/new"><app-icon name="plus" /> Report an incident</a>
  </div>

  <div class="split">
  <div class="split-main">
  @if (loading()) {
    <div class="claim-cards">
      @for (i of [1, 2]; track i) { <div class="card skeleton-card"></div> }
    </div>
  } @else if (claims().length === 0) {
    <div class="card empty-state">
      <span class="empty-icon"><app-icon name="file" [size]="22" /></span>
      <h3>No claims yet</h3>
      <p class="muted">If something has happened, report it here. You can add photos straight from your phone.</p>
    </div>
  }

  @for (g of groups(); track g.title) {
    <section class="claim-group">
      <h3 class="group-title">{{ g.title }} <span class="count">{{ g.items.length }}</span></h3>
      <div class="claim-cards">
        @for (c of g.items; track c.id) {
          <a class="card claim-card" [routerLink]="['/claimant/claims', c.id]" [class.attention]="c.status === 'InfoRequested'">
            <div class="row-between">
              <span class="claim-no">{{ c.claimNumber }}</span>
              <app-status [status]="c.status" />
            </div>
            <div class="claim-meta">
              <app-claim-type [type]="c.type" />
              <span>{{ c.market }}</span>
              <span>Reported {{ c.createdAt | date:'d MMM y' }}</span>
              @if (c.photoCount) { <span class="with-icon"><app-icon name="camera" [size]="14" /> {{ c.photoCount }}</span> }
            </div>
            <div class="claim-amounts">
              <span>Claimed <strong>{{ c.claimedAmount | number:'1.0-0' }}</strong></span>
              @if (c.approvedAmount) { <span>Approved <strong>{{ c.approvedAmount | number:'1.0-0' }}</strong></span> }
            </div>
            @if (c.status === 'InfoRequested') {
              <div class="callout"><app-icon name="alert" [size]="15" /> Action needed: we need more information</div>
            }
            <app-icon class="card-arrow" name="chevronRight" />
          </a>
        }
      </div>
    </section>
  }

  </div>

  <aside class="side-panel">
  <section>
    <h3 class="section-title"><app-icon name="bell" /> Updates</h3>
    <div class="card list-card">
      @for (n of notifications(); track n.id) {
        <div class="notification" [class.unread]="!n.isRead">
          <span>{{ n.message }}</span>
          <span class="muted small">{{ n.createdAt | date:'d MMM, HH:mm' }}</span>
        </div>
      } @empty { <p class="muted pad">No updates yet.</p> }
    </div>
  </section>
  </aside>
  </div>`
})
export class MyClaimsComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  claims = signal<ClaimSummary[]>([]);
  notifications = signal<AppNotification[]>([]);
  loading = signal(true);
  /** Grouped by what the claimant needs to know: act now, waiting on us, or finished. */
  groups = computed(() => [
    { title: 'Needs your action', items: this.claims().filter(c => c.status === 'InfoRequested') },
    { title: 'In progress', items: this.claims().filter(c => ['Submitted', 'UnderReview', 'Approved'].includes(c.status)) },
    { title: 'Closed', items: this.claims().filter(c => c.status === 'Settled' || c.status === 'Rejected') }
  ].filter(g => g.items.length));
  firstName = computed(() => this.auth.user()?.fullName.split(' ')[0] ?? '');

  ngOnInit() {
    this.api.myClaims().subscribe({
      next: c => { this.claims.set(c); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
    this.api.notifications().subscribe(n => this.notifications.set(n));
  }
}
