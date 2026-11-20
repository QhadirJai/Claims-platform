import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AppNotification, ClaimSummary } from '../core/models';
import { StatusBadgeComponent } from '../shared/ui';

@Component({
  selector: 'app-my-claims',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, StatusBadgeComponent],
  template: `
  <div class="page-head">
    <h2>My claims</h2>
    <a class="button primary" routerLink="/claimant/new">Report an incident</a>
  </div>

  @if (claims().length === 0 && !loading()) {
    <div class="card empty">You have no claims yet.</div>
  }

  <div class="claim-cards">
    @for (c of claims(); track c.id) {
      <a class="card claim-card" [routerLink]="['/claimant/claims', c.id]">
        <div class="row-between">
          <strong>{{ c.claimNumber }}</strong>
          <app-status [status]="c.status" />
        </div>
        <div class="muted">{{ c.type }} · {{ c.market }} · reported {{ c.createdAt | date:'mediumDate' }}</div>
        <div>Claimed {{ c.claimedAmount | number:'1.0-0' }}
          @if (c.approvedAmount) { · Approved {{ c.approvedAmount | number:'1.0-0' }} }
        </div>
        @if (c.status === 'InfoRequested') { <div class="callout">Action needed: we need more information</div> }
      </a>
    }
  </div>

  <h3>Updates</h3>
  <div class="card">
    @for (n of notifications(); track n.id) {
      <div class="notification" [class.unread]="!n.isRead">
        <span>{{ n.message }}</span>
        <span class="muted small">{{ n.createdAt | date:'short' }}</span>
      </div>
    } @empty { <p class="muted">No updates yet.</p> }
  </div>`
})
export class MyClaimsComponent implements OnInit {
  private api = inject(ApiService);
  claims = signal<ClaimSummary[]>([]);
  notifications = signal<AppNotification[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.api.myClaims().subscribe(c => { this.claims.set(c); this.loading.set(false); });
    this.api.notifications().subscribe(n => this.notifications.set(n));
  }
}
