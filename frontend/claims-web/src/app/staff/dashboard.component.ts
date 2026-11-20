import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth';
import { Exposure, Workload } from '../core/models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DecimalPipe],
  template: `
  <div class="page-head"><h2>Team dashboard</h2></div>

  @if (workload(); as w) {
    <div class="stats">
      <div class="card stat"><div class="label">Open claims</div><div class="value">{{ w.totalOpen }}</div></div>
      <div class="card stat"><div class="label">Unassigned</div><div class="value">{{ w.unassigned }}</div></div>
      <div class="card stat" [class.warn]="w.oldestUnassignedAgeDays >= 3">
        <div class="label">Oldest unassigned</div><div class="value">{{ w.oldestUnassignedAgeDays }} d</div></div>
      @if (exposure(); as e) {
        <div class="card stat"><div class="label">Outstanding exposure</div><div class="value">{{ e.totalExposure | number:'1.0-0' }}</div></div>
      }
    </div>

    <h3>Workload by officer</h3>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Officer</th><th class="num">Open</th><th class="num">Under review</th><th class="num">Info requested</th>
          <th class="num">Approved (unpaid)</th><th class="num">Oldest open (d)</th><th class="num">Closed 30d</th><th class="num">Avg days to close</th></tr></thead>
        <tbody>
          @for (o of w.officers; track o.officerId) {
            <tr>
              <td>{{ o.officerName }}</td><td class="num">{{ o.open }}</td><td class="num">{{ o.underReview }}</td>
              <td class="num">{{ o.infoRequested }}</td><td class="num">{{ o.approved }}</td>
              <td class="num">{{ o.oldestOpenAgeDays }}</td><td class="num">{{ o.closedLast30Days }}</td>
              <td class="num">{{ o.avgDaysToClose ?? '—' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  }

  @if (auth.isManager()) {
    @if (exposure(); as e) {
      <h3>Liability exposure by market &amp; type</h3>
      <p class="muted small">Open claims count at their reserve (or claimed amount if no reserve is set yet); approved claims at the approved amount until settled.</p>
      <div class="card table-wrap">
        <table>
          <thead><tr><th>Market</th><th>Type</th><th class="num">Open claims</th><th class="num">Reserved</th>
            <th class="num">Unreserved (est.)</th><th class="num">Approved unpaid</th><th class="num">Total</th></tr></thead>
          <tbody>
            @for (b of e.buckets; track b.market + b.type) {
              <tr>
                <td>{{ b.market }}</td><td>{{ b.type }}</td><td class="num">{{ b.openClaims }}</td>
                <td class="num">{{ b.reserved | number:'1.0-0' }}</td><td class="num">{{ b.unreserved | number:'1.0-0' }}</td>
                <td class="num">{{ b.approvedUnpaid | number:'1.0-0' }}</td>
                <td class="num"><strong>{{ b.total | number:'1.0-0' }}</strong>
                  <div class="bar"><span [style.width.%]="e.totalExposure ? (b.total / e.totalExposure * 100) : 0"></span></div></td>
              </tr>
            }
          </tbody>
          <tfoot><tr><td colspan="2">Total</td><td class="num">{{ e.openClaims }}</td><td colspan="3"></td>
            <td class="num"><strong>{{ e.totalExposure | number:'1.0-0' }}</strong></td></tr></tfoot>
        </table>
      </div>
    }
  } @else {
    <p class="muted small">Liability exposure is visible to managers.</p>
  }`
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);
  workload = signal<Workload | null>(null);
  exposure = signal<Exposure | null>(null);

  ngOnInit() {
    this.api.workload().subscribe(w => this.workload.set(w));
    if (this.auth.isManager()) this.api.exposure().subscribe(e => this.exposure.set(e));
  }
}
