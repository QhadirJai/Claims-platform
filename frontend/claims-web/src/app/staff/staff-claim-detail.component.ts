import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth';
import { ClaimDetail } from '../core/models';
import { EventLabelPipe, StatusBadgeComponent } from '../shared/ui';

@Component({
  selector: 'app-staff-claim-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, FormsModule, StatusBadgeComponent, EventLabelPipe],
  template: `
  <a routerLink="/staff" class="back">← Queue</a>
  @if (claim(); as c) {
    <div class="page-head">
      <h2>{{ c.claimNumber }} <span class="muted">· {{ c.claimantName }}</span></h2>
      <app-status [status]="c.status" />
    </div>
    @if (error()) { <p class="error">{{ error() }}</p> }

    <div class="detail-grid">
      <div>
        <div class="card">
          <dl class="facts">
            <dt>Type / market</dt><dd>{{ c.type }} · {{ c.market }}</dd>
            <dt>Policy</dt><dd>{{ c.policyNumber }}</dd>
            <dt>Incident</dt><dd>{{ c.incidentDate | date:'mediumDate' }} · {{ c.location }}</dd>
            <dt>Claimed</dt><dd>{{ c.claimedAmount | number:'1.2-2' }}</dd>
            <dt>Reserve</dt><dd>{{ c.reserveAmount != null ? (c.reserveAmount | number:'1.2-2') : 'Not set' }}</dd>
            @if (c.approvedAmount) { <dt>Approved</dt><dd>{{ c.approvedAmount | number:'1.2-2' }}</dd> }
            @if (c.rejectionReason) { <dt>Rejection reason</dt><dd>{{ c.rejectionReason }}</dd> }
            <dt>Officer</dt><dd>{{ c.assignedOfficerName ?? 'Unassigned' }}</dd>
          </dl>
          <p class="description">{{ c.description }}</p>
        </div>

        <h3>Information requests</h3>
        <div class="card">
          @for (r of c.informationRequests; track r.id) {
            <div class="qa"><strong>Q:</strong> {{ r.question }}<br>
              <strong>A:</strong> {{ r.response ?? 'Awaiting claimant…' }}</div>
          } @empty { <p class="muted">None.</p> }
        </div>

        <h3>Timeline</h3>
        <ol class="timeline card">
          @for (t of c.timeline; track $index) {
            <li><strong>{{ t.eventType | eventLabel }}</strong> <span class="muted small">{{ t.occurredAt | date:'medium' }}</span>
              @if (t.note) { <div class="muted">{{ t.note }}</div> }</li>
          }
        </ol>
      </div>

      <aside class="card actions">
        <h3>Actions</h3>
        @if (c.status === 'Submitted') {
          <button class="primary" (click)="run(api.assign(c.id))">Pick up this claim</button>
        } @else if (!canAct()) {
          <p class="muted">Assigned to {{ c.assignedOfficerName }}. Only they or a manager can act.</p>
        } @else {
          @if (c.status === 'UnderReview' || c.status === 'InfoRequested') {
            <label>Reserve <input type="number" min="0" [(ngModel)]="reserve"></label>
            <button (click)="run(api.setReserve(c.id, reserve))">Set reserve</button>
          }
          @if (c.status === 'UnderReview') {
            <hr>
            <label>Request information <textarea rows="2" [(ngModel)]="question"></textarea></label>
            <button (click)="run(api.requestInfo(c.id, question))" [disabled]="question.trim().length < 5">Send request</button>
            <hr>
            <label>Approve amount <input type="number" min="1" [(ngModel)]="approveAmount"></label>
            <button class="primary" (click)="run(api.approve(c.id, approveAmount))">Approve</button>
            <hr>
            <label>Rejection reason <textarea rows="2" [(ngModel)]="reason"></textarea></label>
            <button class="danger" (click)="run(api.reject(c.id, reason))" [disabled]="reason.trim().length < 5">Reject</button>
          }
          @if (c.status === 'InfoRequested') { <p class="muted">Waiting for the claimant to respond.</p> }
          @if (c.status === 'Approved') {
            <button class="primary" (click)="run(api.settle(c.id))">Mark as settled</button>
          }
          @if (c.status === 'Settled' || c.status === 'Rejected') { <p class="muted">This claim is closed.</p> }
        }
      </aside>
    </div>
  }`
})
export class StaffClaimDetailComponent implements OnInit {
  api = inject(ApiService);
  private auth = inject(AuthService);
  id = input.required<string>();

  claim = signal<ClaimDetail | null>(null);
  error = signal('');
  reserve = 0; approveAmount = 0; question = ''; reason = '';

  // Mirrors the server rule for UX; the API enforces it regardless.
  canAct = computed(() => {
    const c = this.claim();
    return !!c && (this.auth.isManager() || c.assignedOfficerId === this.auth.user()?.id);
  });

  ngOnInit() { this.api.staffClaim(this.id()).subscribe(c => this.set(c)); }

  run(action: Observable<ClaimDetail>) {
    this.error.set('');
    action.subscribe({
      next: c => { this.set(c); this.question = ''; this.reason = ''; },
      error: err => { this.error.set(errorMessage(err)); this.api.staffClaim(this.id()).subscribe(c => this.set(c)); }
    });
  }

  private set(c: ClaimDetail) {
    this.claim.set(c);
    this.reserve = c.reserveAmount ?? c.claimedAmount;
    this.approveAmount = c.reserveAmount ?? c.claimedAmount;
  }
}
