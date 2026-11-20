import { Component, Pipe, PipeTransform, computed, input } from '@angular/core';
import { ClaimStatus, ClaimType } from '../core/models';
import { IconComponent } from './icon';

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
  template: `<span [class]="'badge s-' + status()"><span class="dot"></span>{{ label() }}</span>`
})
export class StatusBadgeComponent {
  status = input.required<ClaimStatus>();
  label = computed(() => LABELS[this.status()]);
}

/** Claim type with its icon (motor / property). */
@Component({
  selector: 'app-claim-type',
  standalone: true,
  imports: [IconComponent],
  template: `<span class="type-chip"><app-icon [name]="type() === 'Motor' ? 'car' : 'home'" [size]="15" />{{ type() }}</span>`
})
export class ClaimTypeComponent {
  type = input.required<ClaimType>();
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
      EvidenceAdded: 'Photos added',
      ClaimApproved: 'Approved',
      ClaimRejected: 'Rejected',
      ClaimSettled: 'Settled'
    } as Record<string, string>)[type] ?? type;
  }
}

@Pipe({ name: 'fileSize', standalone: true })
export class FileSizePipe implements PipeTransform {
  transform(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
