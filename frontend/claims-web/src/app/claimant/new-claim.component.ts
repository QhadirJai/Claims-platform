import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import { CLAIM_TYPES, MARKETS, MAX_PHOTOS, SubmitClaim } from '../core/models';
import { IconComponent } from '../shared/icon';
import { PhotoPickerComponent, PickedPhoto } from '../shared/photos';

@Component({
  selector: 'app-new-claim',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IconComponent, PhotoPickerComponent],
  template: `
  <a routerLink="/claimant" class="back"><app-icon name="arrowLeft" [size]="16" /> My claims</a>
  <div class="page-head">
    <div>
      <h2>Report an incident</h2>
      <p class="muted">Tell us what happened. It takes about two minutes.</p>
    </div>
  </div>

  <div class="split">
  <form class="form-stack" [formGroup]="form" (ngSubmit)="submit()">
    <section class="card form-section">
      <h3 class="form-section-title"><span class="step-no">1</span> Policy</h3>
      <div class="grid-2">
        <label>Claim type
          <select formControlName="type">@for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select>
        </label>
        <label>Market
          <select formControlName="market">@for (m of markets; track m) { <option [value]="m">{{ m }}</option> }</select>
        </label>
      </div>
      <label>Policy number <input formControlName="policyNumber" placeholder="e.g. POL-SG-12345" autocomplete="off"></label>
    </section>

    <section class="card form-section">
      <h3 class="form-section-title"><span class="step-no">2</span> What happened</h3>
      <div class="grid-2">
        <label>Date of incident <input type="date" formControlName="incidentDate" [max]="today"></label>
        <label>Location <input formControlName="location" placeholder="Street, area or postcode"></label>
      </div>
      <label>What happened?
        <textarea formControlName="description" rows="5" placeholder="Describe the incident and the damage (at least 10 characters)"></textarea>
      </label>
      <label>Estimated amount claimed <input type="number" min="1" step="0.01" formControlName="claimedAmount" inputmode="decimal"></label>
    </section>

    <section class="card form-section">
      <h3 class="form-section-title"><span class="step-no">3</span> Photos <span class="muted small optional">Optional</span></h3>
      <p class="muted small">Clear photos of the damage help us assess your claim faster. Location data is removed before upload.</p>
      <app-photo-picker [(photos)]="photos" [limit]="maxPhotos" />
    </section>

    @if (error()) { <p class="error"><app-icon name="alert" [size]="15" /> {{ error() }}</p> }
    <div class="form-actions">
      <a routerLink="/claimant" class="button ghost">Cancel</a>
      <button class="primary" [disabled]="form.invalid || busy()">{{ busyLabel() || 'Submit claim' }}</button>
    </div>
  </form>

  <aside class="side-panel">
    <div class="card panel-card">
      <h3 class="section-title"><app-icon name="clock" /> What happens next</h3>
      <ol class="next-steps">
        <li><strong>A claims officer picks up your claim</strong><span class="muted small">You will see their name on the claim.</span></li>
        <li><strong>They may ask for more details</strong><span class="muted small">Answer and add photos from the claim page.</span></li>
        <li><strong>You get a decision</strong><span class="muted small">Every step is shown on the claim timeline.</span></li>
      </ol>
    </div>
    <div class="card panel-card">
      <h3 class="section-title"><app-icon name="camera" /> Good photos</h3>
      <ul class="tips small muted">
        <li>One wide shot showing the whole vehicle or room</li>
        <li>Close-ups of each damaged area</li>
        <li>Number plates or serial numbers if relevant</li>
      </ul>
    </div>
  </aside>
  </div>`
})
export class NewClaimComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  types = CLAIM_TYPES;
  markets = MARKETS;
  maxPhotos = MAX_PHOTOS;
  today = new Date().toISOString().slice(0, 10);
  photos = signal<PickedPhoto[]>([]);
  busy = signal(false);
  busyLabel = signal('');
  error = signal('');

  form = this.fb.nonNullable.group({
    type: ['Motor', Validators.required],
    market: ['SG', Validators.required],
    policyNumber: ['', [Validators.required, Validators.maxLength(50)]],
    incidentDate: [this.today, Validators.required],
    location: ['', [Validators.required, Validators.maxLength(300)]],
    description: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(4000)]],
    claimedAmount: [0, [Validators.required, Validators.min(0.01)]]
  });

  async submit() {
    this.busy.set(true);
    this.error.set('');
    this.busyLabel.set('Submitting…');

    let claimId: string;
    try {
      claimId = (await firstValueFrom(this.api.submitClaim(this.form.getRawValue() as SubmitClaim))).id;
    } catch (err) {
      this.error.set(errorMessage(err));
      this.busy.set(false);
      this.busyLabel.set('');
      return;
    }

    // The claim exists now. If photos fail, still go to it: they can be added from the claim page.
    let photoError = '';
    const photos = this.photos();
    if (photos.length) {
      this.busyLabel.set(`Uploading ${photos.length} photo${photos.length > 1 ? 's' : ''}…`);
      try { await firstValueFrom(this.api.uploadPhotos(claimId, photos)); }
      catch (err) { photoError = errorMessage(err); }
    }
    this.router.navigate(['/claimant/claims', claimId], { state: photoError ? { photoError } : undefined });
  }
}
