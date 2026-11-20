import { Routes } from '@angular/router';
import { guestGuard, roleGuard } from './core/auth';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./login/login.component').then(m => m.LoginComponent) },

  // Claimant portal (responsive, mobile-first)
  {
    path: 'claimant',
    canActivate: [roleGuard('Claimant')],
    children: [
      { path: '', loadComponent: () => import('./claimant/my-claims.component').then(m => m.MyClaimsComponent) },
      { path: 'new', loadComponent: () => import('./claimant/new-claim.component').then(m => m.NewClaimComponent) },
      { path: 'claims/:id', loadComponent: () => import('./claimant/claim-detail.component').then(m => m.ClaimantClaimDetailComponent) }
    ]
  },

  // Staff portal (desktop-first)
  {
    path: 'staff',
    canActivate: [roleGuard('ClaimsOfficer', 'Manager')],
    children: [
      { path: '', loadComponent: () => import('./staff/queue.component').then(m => m.QueueComponent) },
      { path: 'claims/:id', loadComponent: () => import('./staff/staff-claim-detail.component').then(m => m.StaffClaimDetailComponent) },
      { path: 'inbox', loadComponent: () => import('./staff/inbox.component').then(m => m.InboxComponent) },
      { path: 'dashboard', loadComponent: () => import('./staff/dashboard.component').then(m => m.DashboardComponent) }
    ]
  },

  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' }
];
