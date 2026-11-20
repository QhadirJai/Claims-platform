import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { CLAIM_TYPES, ClaimSummary, MARKETS, STATUSES } from '../core/models';
import { StatusBadgeComponent } from '../shared/ui';

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [FormsModule, RouterLink, DecimalPipe, StatusBadgeComponent],
  template: `
  <div class="page-head"><h2>Claims queue</h2></div>

  <div class="tabs">
    @for (s of scopes; track s.value) {
      <button [class.active]="filter.scope === s.value" (click)="filter.scope = s.value; load()">{{ s.label }}</button>
    }
  </div>

  <div class="filters">
    <select [(ngModel)]="filter.status" (change)="load()"><option value="">All statuses</option>
      @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }</select>
    <select [(ngModel)]="filter.type" (change)="load()"><option value="">All types</option>
      @for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select>
    <select [(ngModel)]="filter.market" (change)="load()"><option value="">All markets</option>
      @for (m of markets; track m) { <option [value]="m">{{ m }}</option> }</select>
    <label class="inline"><input type="checkbox" [(ngModel)]="filter.openOnly" (change)="load()"> Open only</label>
    <span class="muted">{{ total() }} claim(s) · oldest first</span>
  </div>

  @if (error()) { <p class="error">{{ error() }}</p> }

  <div class="card table-wrap">
    <table>
      <thead><tr>
        <th>Claim</th><th>Status</th><th>Type</th><th>Market</th><th>Claimant</th>
        <th class="num">Claimed</th><th class="num">Reserve</th><th>Officer</th><th class="num">Age (d)</th><th></th>
      </tr></thead>
      <tbody>
        @for (c of claims(); track c.id) {
          <tr [class.stale]="c.ageDays >= 7 && c.status === 'Submitted'">
            <td><a [routerLink]="['/staff/claims', c.id]">{{ c.claimNumber }}</a></td>
            <td><app-status [status]="c.status" /></td>
            <td>{{ c.type }}</td><td>{{ c.market }}</td><td>{{ c.claimantName }}</td>
            <td class="num">{{ c.claimedAmount | number:'1.0-0' }}</td>
            <td class="num">{{ c.reserveAmount != null ? (c.reserveAmount | number:'1.0-0') : '—' }}</td>
            <td>{{ c.assignedOfficerName ?? '—' }}</td>
            <td class="num">{{ c.ageDays }}</td>
            <td>@if (c.status === 'Submitted') { <button class="small primary" (click)="pickUp(c.id)">Pick up</button> }</td>
          </tr>
        } @empty { <tr><td colspan="10" class="muted">No claims match.</td></tr> }
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
  error = signal('');

  ngOnInit() { this.load(); }

  load() {
    this.api.staffClaims({ ...this.filter, pageSize: 100 }).subscribe({
      next: r => { this.claims.set(r.items); this.total.set(r.total); this.error.set(''); },
      error: err => this.error.set(errorMessage(err))
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
