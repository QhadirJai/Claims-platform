import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import { ClaimDetail, MAX_PHOTOS } from '../core/models';
import { IconComponent } from '../shared/icon';
import { PhotoGalleryComponent, PhotoPickerComponent, PickedPhoto } from '../shared/photos';
import { ClaimTypeComponent, EventLabelPipe, StatusBadgeComponent } from '../shared/ui';

interface Step { label: string; state: 'done' | 'current' | 'todo' | 'stopped'; }

@Component({
  selector: 'app-claimant-claim-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, FormsModule, StatusBadgeComponent, ClaimTypeComponent, EventLabelPipe,
    IconComponent, PhotoGalleryComponent, PhotoPickerComponent],
  template: `
  <a routerLink="/claimant" class="back"><app-icon name="arrowLeft" [size]="16" /> My claims</a>
  @if (claim(); as c) {
    <div class="page-head">
      <div>
        <h2>{{ c.claimNumber }}</h2>
        <div class="claim-meta"><app-claim-type [type]="c.type" /><span>{{ c.market }}</span>
          <span>Reported {{ c.createdAt | date:'d MMM y' }}</span></div>
      </div>
      <app-status [status]="c.status" />
    </div>

    <ol class="progress" aria-label="Claim progress">
      @for (s of steps(); track s.label) {
        <li [class]="s.state"><span class="progress-dot">@if (s.state === 'done') { <app-icon name="check" [size]="12" /> }</span>{{ s.label }}</li>
      }
    </ol>

    @if (photoError()) {
      <div class="card notice warn"><app-icon name="alert" /> Your claim was submitted, but the photos did not upload: {{ photoError() }} You can add them below.</div>
    }

    <div class="split">
    <div class="split-main">
    @for (r of c.informationRequests; track r.id) {
      @if (!r.respondedAt) {
        <div class="card callout-card">
          <h3 class="with-icon"><app-icon name="message" /> We need more information</h3>
          <p>{{ r.question }}</p>
          <textarea rows="3" [(ngModel)]="answer" placeholder="Your response" aria-label="Your response"></textarea>
          @if (remaining() > 0) {
            <app-photo-picker [(photos)]="answerPhotos" [limit]="remaining()" label="Attach photos (optional)" />
          }
          @if (error()) { <p class="error"><app-icon name="alert" [size]="15" /> {{ error() }}</p> }
          <div class="form-actions">
            <button class="primary" [disabled]="!answer.trim() || busy()" (click)="respond(r.id)">{{ busyLabel() || 'Send response' }}</button>
          </div>
        </div>
      }
    }

    @if (c.status === 'Rejected') {
      <div class="card decision rejected">
        <h3>Decision: not approved.</h3>
        <p>{{ c.rejectionReason }}</p>
      </div>
    }
    @if (c.approvedAmount) {
      <div class="card decision approved">
        <span class="muted small">Approved amount</span>
        <span class="amount">{{ c.approvedAmount | number:'1.2-2' }}</span>
        @if (c.status === 'Settled') { <span class="muted small">Paid and settled {{ c.closedAt | date:'d MMM y' }}</span> }
      </div>
    }

    <div class="card">
      <dl class="facts">
        <dt>Policy</dt><dd>{{ c.policyNumber }}</dd>
        <dt>Incident date</dt><dd>{{ c.incidentDate | date:'d MMM y' }}</dd>
        <dt>Location</dt><dd>{{ c.location }}</dd>
        <dt>Claimed</dt><dd>{{ c.claimedAmount | number:'1.2-2' }}</dd>
        <dt>Handled by</dt><dd>{{ c.assignedOfficerName ?? 'Waiting to be assigned' }}</dd>
      </dl>
      <p class="description">{{ c.description }}</p>
    </div>

    <section class="section photos-section">
      <div class="section-head">
        <h3 class="section-title"><app-icon name="camera" /> Photos <span class="count">{{ c.attachments.length }}</span></h3>
      </div>
      <div class="card">
        <app-photo-gallery [claimId]="c.id" [attachments]="c.attachments" />
        @if (canAddPhotos()) {
          <div class="add-photos">
            <app-photo-picker [(photos)]="newPhotos" [limit]="remaining()" label="Add more photos" />
            @if (newPhotos().length) {
              @if (uploadError()) { <p class="error"><app-icon name="alert" [size]="15" /> {{ uploadError() }}</p> }
              <div class="form-actions">
                <button class="primary" [disabled]="busy()" (click)="uploadNew()">
                  {{ busyLabel() || 'Upload ' + newPhotos().length + ' photo' + (newPhotos().length > 1 ? 's' : '') }}</button>
              </div>
            }
          </div>
        }
      </div>
    </section>

    </div>

    <aside class="side-panel">
      <section>
      <h3 class="section-title"><app-icon name="clock" /> Timeline</h3>
      <ol class="timeline card">
        @for (t of c.timeline; track $index) {
          <li><span class="tl-dot"></span>
            <div><div class="tl-head"><strong>{{ t.eventType | eventLabel }}</strong><span class="muted small">{{ t.occurredAt | date:'d MMM y, HH:mm' }}</span></div>
              @if (t.note) { <div class="muted">{{ t.note }}</div> }</div></li>
        }
      </ol>
      </section>
      <div class="card panel-card help">
        <p class="small muted">Questions about this claim? Your claims officer will contact you here, and every update appears on this timeline.</p>
      </div>
    </aside>
    </div>
  } @else {
    <div class="card skeleton-card tall"></div>
  }`
})
export class ClaimantClaimDetailComponent implements OnInit {
  private api = inject(ApiService);
  id = input.required<string>();   // bound from route param
  claim = signal<ClaimDetail | null>(null);
  answer = '';
  answerPhotos = signal<PickedPhoto[]>([]);
  newPhotos = signal<PickedPhoto[]>([]);
  busy = signal(false);
  busyLabel = signal('');
  error = signal('');
  uploadError = signal('');
  photoError = signal<string>(inject(Router).getCurrentNavigation()?.extras.state?.['photoError'] ?? '');

  remaining = computed(() => MAX_PHOTOS - (this.claim()?.attachments.length ?? 0));
  canAddPhotos = computed(() => {
    const c = this.claim();
    // While an information request is open, photos are added with the response instead.
    return !!c && (c.status === 'Submitted' || c.status === 'UnderReview') && this.remaining() > 0;
  });

  /** Plain-language progress for the claimant: where is my claim now? */
  steps = computed<Step[]>(() => {
    const s = this.claim()?.status;
    if (!s) return [];
    const order = ['Submitted', 'UnderReview', 'Decision', 'Settled'];
    const at = s === 'Submitted' ? 0 : s === 'UnderReview' || s === 'InfoRequested' ? 1 : s === 'Approved' || s === 'Rejected' ? 2 : 3;
    const labels = ['Submitted', s === 'InfoRequested' ? 'Waiting for you' : 'In review',
      s === 'Rejected' ? 'Not approved' : s === 'Approved' || s === 'Settled' ? 'Approved' : 'Decision', 'Paid'];
    return order.map((_, i) => ({
      label: labels[i],
      state: s === 'Rejected' && i === 2 ? 'stopped'
        : s === 'Rejected' && i === 3 ? 'todo'
        : i < at || s === 'Settled' ? 'done' : i === at ? 'current' : 'todo'
    }));
  });

  ngOnInit() { this.api.myClaim(this.id()).subscribe(c => this.claim.set(c)); }

  async respond(requestId: string) {
    this.busy.set(true);
    this.error.set('');
    try {
      const photos = this.answerPhotos();
      if (photos.length) {
        this.busyLabel.set(`Uploading ${photos.length} photo${photos.length > 1 ? 's' : ''}…`);
        this.claim.set(await firstValueFrom(this.api.uploadPhotos(this.id(), photos)));
        this.answerPhotos.set([]);
      }
      this.busyLabel.set('Sending…');
      this.claim.set(await firstValueFrom(this.api.respond(this.id(), requestId, this.answer)));
      this.answer = '';
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
      this.busyLabel.set('');
    }
  }

  async uploadNew() {
    this.busy.set(true);
    this.uploadError.set('');
    this.busyLabel.set('Uploading…');
    try {
      this.claim.set(await firstValueFrom(this.api.uploadPhotos(this.id(), this.newPhotos())));
      this.newPhotos.set([]);
      this.photoError.set('');
    } catch (err) {
      this.uploadError.set(errorMessage(err));
    } finally {
      this.busy.set(false);
      this.busyLabel.set('');
    }
  }
}
