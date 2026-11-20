using System.Net.Http.Headers;
using Claims.Domain;
using Claims.Infrastructure;
using Microsoft.AspNetCore.Mvc;

namespace Claims.Api;

/// <summary>Upload and download plumbing shared by the claimant and staff controllers.</summary>
public static class AttachmentHandling
{
    public const long MaxRequestBytes = Claim.MaxAttachments * ImageSanitizer.MaxBytes + 1024 * 1024;

    /// <summary>
    /// Validates and sanitises every file first (so one bad file rejects the whole batch before anything
    /// is stored), then writes the bytes to object storage. Keys are server-generated: the client's file
    /// name is display-only and never part of a path.
    /// </summary>
    public static async Task<List<NewAttachment>> StoreAsync(
        Guid claimId, IFormFileCollection files, IObjectStorage storage, CancellationToken ct)
    {
        if (files.Count == 0) throw new DomainException("No photos were provided.");
        if (files.Count > Claim.MaxAttachments) throw new DomainException($"Upload at most {Claim.MaxAttachments} photos at a time.");

        var prepared = new List<(NewAttachment Meta, byte[] Bytes)>();
        foreach (var file in files)
        {
            var displayName = ImageSanitizer.SafeFileName(file.FileName, "");
            if (file.Length > ImageSanitizer.MaxBytes)
                throw new InvalidImageException($"{displayName}: each photo must be 10 MB or smaller.");

            using var ms = new MemoryStream((int)file.Length);
            await file.CopyToAsync(ms, ct);

            SanitizedImage image;
            try { image = ImageSanitizer.Sanitize(ms.ToArray()); }
            catch (InvalidImageException ex) { throw new InvalidImageException($"{displayName}: {ex.Message}"); }

            var id = Guid.NewGuid();
            prepared.Add((new NewAttachment(id, ImageSanitizer.SafeFileName(file.FileName, image.Extension),
                image.ContentType, image.Bytes.LongLength, $"claims/{claimId}/{id}"), image.Bytes));
        }

        var stored = new List<NewAttachment>();
        try
        {
            foreach (var (meta, bytes) in prepared)
            {
                await storage.PutAsync(meta.StorageKey, bytes, meta.ContentType, ct);
                stored.Add(meta);
            }
        }
        catch
        {
            await DeleteAsync(stored, storage);
            throw;
        }
        return stored;
    }

    /// <summary>Compensation when the DB write fails after the bytes were stored.</summary>
    public static Task DeleteAsync(IEnumerable<NewAttachment> files, IObjectStorage storage) =>
        Task.WhenAll(files.Select(f => storage.DeleteAsync(f.StorageKey, CancellationToken.None)));

    /// <summary>
    /// Streams a photo inline. Content-Type comes from what we validated at upload, nosniff stops the
    /// browser second-guessing it, and the sandbox CSP neutralises the response if opened directly.
    /// </summary>
    public static async Task<IActionResult> ServeAsync(ClaimAttachment a, HttpResponse response, IObjectStorage storage, CancellationToken ct)
    {
        var stream = await storage.OpenReadAsync(a.StorageKey, ct);
        response.Headers.XContentTypeOptions = "nosniff";
        response.Headers.CacheControl = "private, max-age=3600";
        response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = a.FileName }.ToString();
        return new FileStreamResult(stream, a.ContentType);
    }
}
