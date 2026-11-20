import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AppNotification, ClaimDetail, ClaimSummary, Exposure, LoginResponse, Paged, SubmitClaim, User, Workload
} from './models';

export const API_URL = 'http://localhost:5080/api';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  // Auth
  login(email: string, password: string) { return this.http.post<LoginResponse>(`${API_URL}/auth/login`, { email, password }); }
  me() { return this.http.get<User>(`${API_URL}/auth/me`); }

  // Claimant
  submitClaim(body: SubmitClaim) { return this.http.post<ClaimDetail>(`${API_URL}/claims`, body); }
  myClaims() { return this.http.get<ClaimSummary[]>(`${API_URL}/claims/mine`); }
  myClaim(id: string) { return this.http.get<ClaimDetail>(`${API_URL}/claims/${id}`); }
  respond(id: string, requestId: string, response: string) {
    return this.http.post<ClaimDetail>(`${API_URL}/claims/${id}/info-requests/${requestId}/response`, { response });
  }

  /** Multipart upload; field name "files" matches the API. */
  uploadPhotos(id: string, photos: { blob: Blob; name: string }[]) {
    const form = new FormData();
    for (const p of photos) form.append('files', p.blob, p.name);
    return this.http.post<ClaimDetail>(`${API_URL}/claims/${id}/attachments`, form);
  }

  /** Photos are behind auth, so they are fetched as blobs (an <img src> cannot send the bearer token). */
  photoUrl(scope: 'claimant' | 'staff', claimId: string, attachmentId: string) {
    return scope === 'staff'
      ? `${API_URL}/staff/claims/${claimId}/attachments/${attachmentId}`
      : `${API_URL}/claims/${claimId}/attachments/${attachmentId}`;
  }
  photo(url: string) { return this.http.get(url, { responseType: 'blob' }); }

  // Staff
  staffClaims(filter: Record<string, string | number | boolean | null | undefined>) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filter)) if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    return this.http.get<Paged<ClaimSummary>>(`${API_URL}/staff/claims`, { params });
  }
  staffClaim(id: string) { return this.http.get<ClaimDetail>(`${API_URL}/staff/claims/${id}`); }
  assign(id: string) { return this.http.post<ClaimDetail>(`${API_URL}/staff/claims/${id}/assign`, {}); }
  setReserve(id: string, amount: number) { return this.http.put<ClaimDetail>(`${API_URL}/staff/claims/${id}/reserve`, { amount }); }
  requestInfo(id: string, question: string) { return this.http.post<ClaimDetail>(`${API_URL}/staff/claims/${id}/info-requests`, { question }); }
  approve(id: string, amount: number) { return this.http.post<ClaimDetail>(`${API_URL}/staff/claims/${id}/approve`, { amount }); }
  reject(id: string, reason: string) { return this.http.post<ClaimDetail>(`${API_URL}/staff/claims/${id}/reject`, { reason }); }
  settle(id: string) { return this.http.post<ClaimDetail>(`${API_URL}/staff/claims/${id}/settle`, {}); }
  workload() { return this.http.get<Workload>(`${API_URL}/staff/dashboard/workload`); }
  exposure() { return this.http.get<Exposure>(`${API_URL}/staff/dashboard/exposure`); }

  // Notifications
  notifications() { return this.http.get<AppNotification[]>(`${API_URL}/notifications`); }
  markRead(id: string) { return this.http.post<void>(`${API_URL}/notifications/${id}/read`, {}); }
  markAllRead() { return this.http.post<void>(`${API_URL}/notifications/read-all`, {}); }
  unreadCount() { return this.http.get<{ count: number }>(`${API_URL}/notifications/unread-count`); }
}

/** Extracts a readable message from an API ProblemDetails / validation error. */
export function errorMessage(err: any): string {
  const e = err?.error;
  if (e?.detail) return e.detail;
  if (e?.errors) return Object.values(e.errors).flat().join(' ');
  if (e?.title) return e.title;
  if (err?.status === 0) return 'Cannot reach the server. Is the API running on port 5080?';
  return 'Something went wrong.';
}
