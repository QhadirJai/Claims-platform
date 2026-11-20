import { Component, HostListener, Injectable, effect, inject, input, model, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth';
import { Attachment } from '../core/models';
import { IconComponent } from './icon';

// ── Loading protected photos ─────────────────────────────────────────────────

/**
 * Fetches photos with the bearer token and hands out object URLs. Cached per URL for the session
 * so moving between pages never re-downloads; revoked on sign-out.
 */
@Injectable({ providedIn: 'root' })
export class PhotoCache {
  private api = inject(ApiService);
  private cache = new Map<string, Promise<string>>();

  constructor() {
    inject(AuthService).onLogout.push(() => this.clear());
  }

  get(url: string): Promise<string> {
    let p = this.cache.get(url);
    if (!p) {
      p = firstValueFrom(this.api.photo(url)).then(blob => URL.createObjectURL(blob));
      p.catch(() => this.cache.delete(url));
      this.cache.set(url, p);
    }
    return p;
  }

  private clear() {
    for (const p of this.cache.values()) p.then(u => URL.revokeObjectURL(u), () => {});
    this.cache.clear();
  }
}

// ── Gallery + lightbox ───────────────────────────────────────────────────────

@Component({
  selector: 'app-photo-gallery',
  standalone: true,
  imports: [IconComponent],
  template: `
  @if (attachments().length) {
    <div class="gallery">
      @for (a of attachments(); track a.id; let i = $index) {
        <button type="button" class="thumb" (click)="open(i)" [attr.aria-label]="'View photo ' + a.fileName">
          @if (urls()[a.id]; as u) { <img [src]="u" [alt]="a.fileName"> }
          @else { <span class="thumb-loading"></span> }
        </button>
      }
    </div>
  } @else {
    <p class="muted small empty-photos"><app-icon name="image" [size]="16" /> {{ emptyText() }}</p>
  }

  @if (current() !== null) {
    <div class="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" (click)="close()">
      <div class="lightbox-bar" (click)="$event.stopPropagation()">
        <span>{{ attachments()[current()!].fileName }} <span class="muted">· {{ current()! + 1 }} of {{ attachments().length }}</span></span>
        <button type="button" class="icon-btn on-dark" (click)="close()" aria-label="Close photo"><app-icon name="x" [size]="20" /></button>
      </div>
      @if (attachments().length > 1) {
        <button type="button" class="lightbox-nav prev icon-btn on-dark" (click)="step(-1); $event.stopPropagation()" aria-label="Previous photo">
          <app-icon name="chevronLeft" [size]="24" /></button>
        <button type="button" class="lightbox-nav next icon-btn on-dark" (click)="step(1); $event.stopPropagation()" aria-label="Next photo">
          <app-icon name="chevronRight" [size]="24" /></button>
      }
      @if (urls()[attachments()[current()!].id]; as u) {
        <img class="lightbox-img" [src]="u" [alt]="attachments()[current()!].fileName" (click)="$event.stopPropagation()">
      }
    </div>
  }`
})
export class PhotoGalleryComponent {
  private api = inject(ApiService);
  private photos = inject(PhotoCache);

  claimId = input.required<string>();
  attachments = input.required<Attachment[]>();
  scope = input<'claimant' | 'staff'>('claimant');
  emptyText = input('No photos yet.');

  urls = signal<Record<string, string>>({});
  current = signal<number | null>(null);

  constructor() {
    effect(() => {
      for (const a of this.attachments()) {
        if (this.urls()[a.id]) continue;
        this.photos.get(this.api.photoUrl(this.scope(), this.claimId(), a.id))
          .then(u => this.urls.update(m => ({ ...m, [a.id]: u })), () => {});
      }
    });
  }

  open(i: number) { this.current.set(i); }
  close() { this.current.set(null); }
  step(d: number) {
    const n = this.attachments().length;
    this.current.update(i => i === null ? null : (i + d + n) % n);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (this.current() === null) return;
    if (e.key === 'Escape') this.close();
    if (e.key === 'ArrowRight') this.step(1);
    if (e.key === 'ArrowLeft') this.step(-1);
  }
}

// ── Picker (select, prepare, preview) ────────────────────────────────────────

export interface PickedPhoto { id: string; blob: Blob; name: string; preview: string; }

const MAX_EDGE = 2048;        // long edge after resizing: plenty for assessing damage
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

/**
 * Prepares a photo in the browser before upload: decodes it (applying camera orientation),
 * scales the long edge to 2048px and re-encodes as JPEG. That makes a 6 MB phone photo roughly
 * 400 KB, so uploads are quick on mobile data, and re-encoding drops all metadata including GPS.
 * The server still validates and strips metadata itself; this is not a security boundary.
 */
async function preparePhoto(file: File): Promise<PickedPhoto> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`${file.name} is larger than 30 MB.`);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`${file.name} could not be read. Use a JPEG or PNG photo.`); }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error(`${file.name} could not be processed.`)), 'image/jpeg', 0.85));
  const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return { id: crypto.randomUUID(), blob, name: `${base}.jpg`, preview: URL.createObjectURL(blob) };
}

@Component({
  selector: 'app-photo-picker',
  standalone: true,
  imports: [IconComponent],
  template: `
  <div class="picker" [class.dragging]="dragging()"
       (dragover)="$event.preventDefault(); dragging.set(true)" (dragleave)="dragging.set(false)" (drop)="onDrop($event)">
    @if (photos().length) {
      <div class="gallery picker-grid">
        @for (p of photos(); track p.id) {
          <div class="thumb picked">
            <img [src]="p.preview" [alt]="p.name">
            <button type="button" class="remove" (click)="remove(p)" [attr.aria-label]="'Remove ' + p.name">
              <app-icon name="x" [size]="14" /></button>
          </div>
        }
        @if (photos().length < limit()) {
          <label class="thumb add-tile">
            <app-icon name="plus" [size]="20" />
            <span class="sr-only">Add more photos</span>
            <input type="file" accept="image/*" multiple (change)="onSelect($event)">
          </label>
        }
      </div>
    } @else {
      <label class="dropzone">
        <span class="dropzone-icon"><app-icon name="camera" [size]="22" /></span>
        <span><strong>{{ label() }}</strong><br>
          <span class="muted small">Take a photo or choose from your device. Up to {{ limit() }}, JPEG or PNG.</span></span>
        <input type="file" accept="image/*" multiple (change)="onSelect($event)" [attr.aria-label]="label()">
      </label>
    }
    @if (processing()) { <p class="muted small"><span class="spinner"></span> Preparing photos…</p> }
    @for (e of errors(); track $index) { <p class="error small"><app-icon name="alert" [size]="14" /> {{ e }}</p> }
  </div>`
})
export class PhotoPickerComponent {
  photos = model<PickedPhoto[]>([]);
  limit = input(10);
  label = input('Add photos of the damage');

  processing = signal(false);
  dragging = signal(false);
  errors = signal<string[]>([]);

  onSelect(e: Event) {
    const inputEl = e.target as HTMLInputElement;
    this.add(Array.from(inputEl.files ?? []));
    inputEl.value = ''; // allow choosing the same file again after removing it
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging.set(false);
    this.add(Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/')));
  }

  remove(p: PickedPhoto) {
    URL.revokeObjectURL(p.preview);
    this.photos.update(list => list.filter(x => x.id !== p.id));
  }

  private async add(files: File[]) {
    if (!files.length) return;
    const errors: string[] = [];
    const room = this.limit() - this.photos().length;
    if (files.length > room) {
      errors.push(`Only ${this.limit()} photos per claim. ${files.length - room} not added.`);
      files = files.slice(0, Math.max(0, room));
    }
    this.processing.set(true);
    const results = await Promise.allSettled(files.map(preparePhoto));
    this.processing.set(false);

    const ok: PickedPhoto[] = [];
    for (const r of results) r.status === 'fulfilled' ? ok.push(r.value) : errors.push((r.reason as Error).message);
    this.photos.update(list => [...list, ...ok]);
    this.errors.set(errors);
  }
}
