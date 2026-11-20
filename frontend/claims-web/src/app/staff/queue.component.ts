import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { CLAIM_TYPES, ClaimSummary, MARKETS, STATUSES } from '../core/models';
import { IconComponent } from '../shared/icon';
import { ClaimTypeComponent, StatusBadgeComponent } from '../shared/ui';

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [FormsModule, RouterLink, DecimalPipe, StatusBadgeComponent, ClaimTypeComponent, IconComponent],
  template: `
  <div class="page-head">
    <div>
      <h2>Claims queue</h2>
      <p class="muted">Oldest first. Unassigned claims waiting 7 days or more are highlighted.</p>
    </div>
  </div>

  <div class="toolbar">
    <div class="segmented" role="group" aria-label="Scope">
      @for (s of scopes; track s.value) {
        <button [attr.aria-pressed]="filter.scope === s.value" [class.active]="filter.scope === s.value"
                (click)="filter.scope = s.value; load()">{{ s.label }}</button>
      }
    </div>

    <div class="filters">
      <select [(ngModel)]="filter.status" (change)="load()" aria-label="Status"><option value="">All statuses</option>
        @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }</select>
      <select [(ngModel)]="filter.type" (change)="load()" aria-label="Type"><option value="">All types</option>
        @for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select>
      <select [(ngModel)]="filter.market" (change)="load()" aria-label="Market"><option value="">All markets</option>
        @for (m of markets; track m) { <option [value]="m">{{ m }}</option> }</select>
      <label class="check"><input type="checkbox" [(ngModel)]="filter.openOnly" (change)="load()"> Open only</label>
    </div>
    <span class="muted small result-count">{{ total() }} claim{{ total() === 1 ? '' : 's' }}</span>
  </div>

  @if (error()) { <p class="error"><app-icon name="alert" [size]="15" /> {{ error() }}</p> }

  <div class="card table-wrap" [class.loading]="loading()">
    <table>
      <thead><tr>
        <th>Claim</th><th>Status</th><th>Type</th><th>Claimant</th>
        <th class="num">Claimed</th><th class="num">Reserve</th><th>Officer</th><th class="num">Age</th>
        <th class="num" aria-label="Photos"><app-icon name="camera" [size]="15" /></th><th></th>
      </tr></thead>
      <tbody>
        @for (c of claims(); track c.id) {
          <tr [class.stale]="c.ageDays >= 7 && c.status === 'Submitted'">
            <td><a class="claim-link" [routerLink]="['/staff/claims', c.id]">{{ c.claimNumber }}</a></td>
            <td><app-status [status]="c.status" /></td>
            <td><app-claim-type [type]="c.type" /> <span class="muted">· {{ c.market }}</span></td><td>{{ c.claimantName }}</td>
            <td class="num">{{ c.claimedAmount | number:'1.0-0' }}</td>
            <td class="num">{{ c.reserveAmount != null ? (c.reserveAmount | number:'1.0-0') : '—' }}</td>
            <td>{{ c.assignedOfficerName ?? '—' }}</td>
            <td class="num">{{ c.ageDays }}d</td>
            <td class="num muted">{{ c.photoCount || '' }}</td>
            <td class="row-action">@if (c.status === 'Submitted') { <button class="small primary" (click)="pickUp(c.id)">Pick up</button> }</td>
          </tr>
        } @empty { <tr><td colspan="10" class="muted empty-row">No claims match these filters.</td></tr> }
      </tbody>
    </table>
  </div>`
})
export class QueueComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);

  scopes = [
    { value: 'unassigned', label: 'Unassigned' },
    { value: 'mine', label: 'My claims' },
    { value: 'all', label: 'All claims' }
  ];
  statuses = STATUSES; types = CLAIM_TYPES; markets = MARKETS;
  filter = { scope: 'unassigned', status: '', type: '', market: '', openOnly: false };

  claims = signal<ClaimSummary[]>([]);
  total = signal(0);
  loading = signal(true);
  error = signal('');

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.api.staffClaims({ ...this.filter, pageSize: 100 }).subscribe({
      next: r => { this.claims.set(r.items); this.total.set(r.total); this.error.set(''); this.loading.set(false); },
      error: err => { this.error.set(errorMessage(err)); this.loading.set(false); }
    });
  }

  pickUp(id: string) {
    this.api.assign(id).subscribe({
      next: () => this.router.navigate(['/staff/claims', id]),
      // 409 → someone else picked it up first
      error: err => { this.error.set(errorMessage(err)); this.load(); }
    });
  }
}
