import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { CLAIM_TYPES, MARKETS, SubmitClaim } from '../core/models';

@Component({
  selector: 'app-new-claim',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
  <a routerLink="/claimant" class="back">← My claims</a>
  <h2>Report an incident</h2>
  <form class="card form" [formGroup]="form" (ngSubmit)="submit()">
    <div class="grid-2">
      <label>Claim type
        <select formControlName="type">@for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select>
      </label>
      <label>Market
        <select formControlName="market">@for (m of markets; track m) { <option [value]="m">{{ m }}</option> }</select>
      </label>
      <label>Policy number <input formControlName="policyNumber" placeholder="e.g. POL-SG-12345"></label>
      <label>Date of incident <input type="date" formControlName="incidentDate" [max]="today"></label>
    </div>
    <label>Location <input formControlName="location" placeholder="Where did it happen?"></label>
    <label>What happened?
      <textarea formControlName="description" rows="5" placeholder="Describe the incident and the damage (min. 10 characters)"></textarea>
    </label>
    <label>Estimated amount claimed <input type="number" min="1" step="0.01" formControlName="claimedAmount"></label>

    @if (error()) { <p class="error">{{ error() }}</p> }
    <button class="primary" [disabled]="form.invalid || busy()">{{ busy() ? 'Submitting…' : 'Submit claim' }}</button>
  </form>`
})
export class NewClaimComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  types = CLAIM_TYPES;
  markets = MARKETS;
  today = new Date().toISOString().slice(0, 10);
  busy = signal(false);
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

  submit() {
    this.busy.set(true);
    this.error.set('');
    this.api.submitClaim(this.form.getRawValue() as SubmitClaim).subscribe({
      next: c => this.router.navigate(['/claimant/claims', c.id]),
      error: err => { this.error.set(errorMessage(err)); this.busy.set(false); }
    });
  }
}
