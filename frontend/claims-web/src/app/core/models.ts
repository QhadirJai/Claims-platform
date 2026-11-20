// Mirrors the backend contract (backend/src/Claims.Api/Contracts.cs). The API owns the contract;
// Swagger at /swagger is the source of truth.

export type UserRole = 'Claimant' | 'ClaimsOfficer' | 'Manager';
export type ClaimType = 'Motor' | 'Property';
export type Market = 'SG' | 'MY' | 'HK' | 'AU' | 'TH' | 'ID';
export type ClaimStatus = 'Submitted' | 'UnderReview' | 'InfoRequested' | 'Approved' | 'Rejected' | 'Settled';

export const MARKETS: Market[] = ['SG', 'MY', 'HK', 'AU', 'TH', 'ID'];
export const CLAIM_TYPES: ClaimType[] = ['Motor', 'Property'];
export const STATUSES: ClaimStatus[] = ['Submitted', 'UnderReview', 'InfoRequested', 'Approved', 'Rejected', 'Settled'];

export interface User { id: string; email: string; fullName: string; role: UserRole; }
export interface LoginResponse { token: string; expiresAt: string; user: User; }

export interface ClaimSummary {
  id: string; claimNumber: string; type: ClaimType; market: Market; status: ClaimStatus;
  claimedAmount: number; reserveAmount: number | null; approvedAmount: number | null;
  claimantName: string; assignedOfficerName: string | null;
  createdAt: string; updatedAt: string; ageDays: number; photoCount: number;
}

export interface InformationRequest {
  id: string; question: string; response: string | null; requestedAt: string; respondedAt: string | null;
}

export interface Attachment { id: string; fileName: string; contentType: string; sizeBytes: number; uploadedAt: string; }

export const MAX_PHOTOS = 10;

export interface TimelineEntry {
  eventType: string; fromStatus: ClaimStatus | null; toStatus: ClaimStatus; note: string | null; occurredAt: string;
}

export interface ClaimDetail {
  id: string; claimNumber: string; type: ClaimType; market: Market; status: ClaimStatus;
  policyNumber: string; incidentDate: string; location: string; description: string;
  claimedAmount: number; reserveAmount: number | null; approvedAmount: number | null; rejectionReason: string | null;
  claimantName: string; assignedOfficerId: string | null; assignedOfficerName: string | null;
  createdAt: string; updatedAt: string; closedAt: string | null;
  informationRequests: InformationRequest[];
  timeline: TimelineEntry[];
  attachments: Attachment[];
}

export interface SubmitClaim {
  type: ClaimType; market: Market; policyNumber: string; incidentDate: string;
  location: string; description: string; claimedAmount: number;
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; }

export interface OfficerWorkload {
  officerId: string; officerName: string; open: number; underReview: number; infoRequested: number;
  approved: number; oldestOpenAgeDays: number; closedLast30Days: number; avgDaysToClose: number | null;
}
export interface Workload { unassigned: number; oldestUnassignedAgeDays: number; totalOpen: number; officers: OfficerWorkload[]; }

export interface ExposureBucket {
  market: string; type: string; openClaims: number; reserved: number; unreserved: number; approvedUnpaid: number; total: number;
}
export interface Exposure { totalExposure: number; openClaims: number; buckets: ExposureBucket[]; }

export interface AppNotification { id: string; claimId: string; message: string; isRead: boolean; createdAt: string; }
