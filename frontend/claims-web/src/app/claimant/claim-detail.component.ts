import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { ClaimDetail } from '../core/models';
import { EventLabelPipe, StatusBadgeComponent } from '../shared/ui';

@Component({
  selector: 'app-claimant-claim-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, FormsModule, StatusBadgeComponent, EventLabelPipe],
  template: `
  <a routerLink="/claimant" class="back">← My claims</a>
  @if (claim(); as c) {
    <div class="page-head">
      <h2>{{ c.claimNumber }}</h2>
      <app-status [status]="c.status" />
    </div>

    @for (r of c.informationRequests; track r.id) {
      @if (!r.respondedAt) {
        <div class="card callout-card">
          <h3>We need more information</h3>
          <p>{{ r.question }}</p>
          <textarea rows="3" [(ngModel)]="answer" placeholder="Your response"></textarea>
          @if (error()) { <p class="error">{{ error() }}</p> }
          <button class="primary" [disabled]="!answer.trim() || busy()" (click)="respond(r.id)">Send response</button>
        </div>
      }
    }

    @if (c.status === 'Rejected') { <div class="card"><strong>Decision:</strong> not approved. {{ c.rejectionReason }}</div> }
    @if (c.approvedAmount) { <div class="card"><strong>Approved amount:</strong> {{ c.approvedAmount | number:'1.2-2' }}</div> }

    <div class="card">
      <dl class="facts">
        <dt>Type</dt><dd>{{ c.type }} · {{ c.market }}</dd>
        <dt>Policy</dt><dd>{{ c.policyNumber }}</dd>
        <dt>Incident date</dt><dd>{{ c.incidentDate | date:'mediumDate' }}</dd>
        <dt>Location</dt><dd>{{ c.location }}</dd>
        <dt>Claimed</dt><dd>{{ c.claimedAmount | number:'1.2-2' }}</dd>
        <dt>Handled by</dt><dd>{{ c.assignedOfficerName ?? 'Waiting to be assigned' }}</dd>
      </dl>
      <p class="description">{{ c.description }}</p>
    </div>

    <h3>Timeline</h3>
    <ol class="timeline card">
      @for (t of c.timeline; track $index) {
        <li><strong>{{ t.eventType | eventLabel }}</strong> <span class="muted small">{{ t.occurredAt | date:'medium' }}</span>
          @if (t.note) { <div class="muted">{{ t.note }}</div> }</li>
      }
    </ol>
  }`
})
export class ClaimantClaimDetailComponent implements OnInit {
  private api = inject(ApiService);
  id = input.required<string>();   // bound from route param
  claim = signal<ClaimDetail | null>(null);
  answer = '';
  busy = signal(false);
  error = signal('');

  ngOnInit() { this.api.myClaim(this.id()).subscribe(c => this.claim.set(c)); }

  respond(requestId: string) {
    this.busy.set(true);
    this.error.set('');
    this.api.respond(this.id(), requestId, this.answer).subscribe({
      next: c => { this.claim.set(c); this.answer = ''; this.busy.set(false); },
      error: err => { this.error.set(errorMessage(err)); this.busy.set(false); }
    });
  }
}
