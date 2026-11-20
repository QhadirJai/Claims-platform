import { Component, Pipe, PipeTransform, input } from '@angular/core';
import { ClaimStatus } from '../core/models';

const LABELS: Record<ClaimStatus, string> = {
  Submitted: 'Submitted',
  UnderReview: 'Under review',
  InfoRequested: 'Info requested',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Settled: 'Settled'
};

@Component({
  selector: 'app-status',
  standalone: true,
  template: `<span class="badge" [class]="'badge s-' + status()">{{ label() }}</span>`
})
export class StatusBadgeComponent {
  status = input.required<ClaimStatus>();
  label = () => LABELS[this.status()];
}

@Pipe({ name: 'eventLabel', standalone: true })
export class EventLabelPipe implements PipeTransform {
  transform(type: string): string {
    return ({
      ClaimSubmitted: 'Claim submitted',
      ClaimAssigned: 'Picked up for review',
      ReserveSet: 'Reserve updated',
      InfoRequested: 'Information requested',
      InfoProvided: 'Information provided',
      ClaimApproved: 'Approved',
      ClaimRejected: 'Rejected',
      ClaimSettled: 'Settled'
    } as Record<string, string>)[type] ?? type;
  }
}
