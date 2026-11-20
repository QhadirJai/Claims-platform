import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth';
import { ClaimDetail } from '../core/models';
import { IconComponent } from '../shared/icon';
import { PhotoGalleryComponent } from '../shared/photos';
import { ClaimTypeComponent, EventLabelPipe, StatusBadgeComponent } from '../shared/ui';

@Component({
  selector: 'app-staff-claim-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, FormsModule, StatusBadgeComponent, ClaimTypeComponent, EventLabelPipe,
    IconComponent, PhotoGalleryComponent],
  template: `
  <a routerLink="/staff" class="back"><app-icon name="arrowLeft" [size]="16" /> Queue</a>
  @if (claim(); as c) {
    <div class="page-head">
      <div>
        <h2>{{ c.claimNumber }}</h2>
        <div class="claim-meta"><span class="with-icon"><app-icon name="user" [size]="14" /> {{ c.claimantName }}</span>
          <app-claim-type [type]="c.type" /><span>{{ c.market }}</span><span>Opened {{ c.createdAt | date:'d MMM y' }}</span></div>
      </div>
      <app-status [status]="c.status" />
    </div>
    @if (error()) { <p class="error"><app-icon name="alert" [size]="15" /> {{ error() }}</p> }

    <div class="detail-grid">
      <div class="detail-main">
        <div class="card">
          <dl class="facts">
            <dt>Policy</dt><dd>{{ c.policyNumber }}</dd>
            <dt>Incident</dt><dd>{{ c.incidentDate | date:'d MMM y' }} · {{ c.location }}</dd>
            <dt>Claimed</dt><dd>{{ c.claimedAmount | number:'1.2-2' }}</dd>
            <dt>Reserve</dt><dd>{{ c.reserveAmount != null ? (c.reserveAmount | number:'1.2-2') : 'Not set' }}</dd>
            @if (c.approvedAmount) { <dt>Approved</dt><dd>{{ c.approvedAmount | number:'1.2-2' }}</dd> }
            @if (c.rejectionReason) { <dt>Rejection reason</dt><dd>{{ c.rejectionReason }}</dd> }
            <dt>Officer</dt><dd>{{ c.assignedOfficerName ?? 'Unassigned' }}</dd>
          </dl>
          <p class="description">{{ c.description }}</p>
        </div>

        <section class="section">
          <h3 class="section-title"><app-icon name="camera" /> Photo evidence <span class="count">{{ c.attachments.length }}</span></h3>
          <div class="card">
            <app-photo-gallery [claimId]="c.id" [attachments]="c.attachments" scope="staff"
                               emptyText="The claimant has not added photos. Request them below if needed." />
          </div>
        </section>

        <section class="section">
          <h3 class="section-title"><app-icon name="message" /> Information requests</h3>
          <div class="card list-card">
            @for (r of c.informationRequests; track r.id) {
              <div class="qa">
                <div class="qa-q"><span class="qa-tag">Q</span> {{ r.question }}</div>
                <div class="qa-a" [class.pending]="!r.response"><span class="qa-tag">A</span> {{ r.response ?? 'Awaiting claimant…' }}</div>
              </div>
            } @empty { <p class="muted pad">None.</p> }
          </div>
        </section>

        <section class="section">
          <h3 class="section-title"><app-icon name="clock" /> Timeline</h3>
          <ol class="timeline card">
            @for (t of c.timeline; track $index) {
              <li><span class="tl-dot"></span>
                <div><div class="tl-head"><strong>{{ t.eventType | eventLabel }}</strong><span class="muted small">{{ t.occurredAt | date:'d MMM y, HH:mm' }}</span></div>
                  @if (t.note) { <div class="muted">{{ t.note }}</div> }</div></li>
            }
          </ol>
        </section>
      </div>

      <aside class="card actions">
        <h3>Actions</h3>
        @if (c.status === 'Submitted') {
          <button class="primary block" (click)="run(api.assign(c.id))">Pick up this claim</button>
        } @else if (!canAct()) {
          <p class="muted">Assigned to {{ c.assignedOfficerName }}. Only they or a manager can act.</p>
        } @else {
          @if (c.status === 'UnderReview' || c.status === 'InfoRequested') {
            <div class="action-group">
              <label>Reserve <input type="number" min="0" [(ngModel)]="reserve"></label>
              <button class="block" (click)="run(api.setReserve(c.id, reserve))">Set reserve</button>
            </div>
          }
          @if (c.status === 'UnderReview') {
            <div class="action-group">
              <label>Request information <textarea rows="2" [(ngModel)]="question"></textarea></label>
              <button class="block" (click)="run(api.requestInfo(c.id, question))" [disabled]="question.trim().length < 5">Send request</button>
            </div>
            <div class="action-group">
              <label>Approve amount <input type="number" min="1" [(ngModel)]="approveAmount"></label>
              <button class="primary block" (click)="run(api.approve(c.id, approveAmount))">Approve</button>
            </div>
            <div class="action-group">
              <label>Rejection reason <textarea rows="2" [(ngModel)]="reason"></textarea></label>
              <button class="danger block" (click)="run(api.reject(c.id, reason))" [disabled]="reason.trim().length < 5">Reject</button>
            </div>
          }
          @if (c.status === 'InfoRequested') { <p class="muted small">Waiting for the claimant to respond.</p> }
          @if (c.status === 'Approved') {
            <button class="primary block" (click)="run(api.settle(c.id))">Mark as settled</button>
          }
          @if (c.status === 'Settled' || c.status === 'Rejected') {
            <p class="muted with-icon"><app-icon name="check" [size]="16" /> This claim is closed.</p>
          }
        }
      </aside>
    </div>
  } @else {
    <div class="card skeleton-card tall"></div>
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
