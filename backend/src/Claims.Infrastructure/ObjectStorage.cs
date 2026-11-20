using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging;

namespace Claims.Infrastructure;

/// <summary>Blob storage for claim photos. Bytes never live in Postgres; the DB keeps metadata only.</summary>
public interface IObjectStorage
{
    Task PutAsync(string key, byte[] bytes, string contentType, CancellationToken ct);
    Task<Stream> OpenReadAsync(string key, CancellationToken ct);
    Task DeleteAsync(string key, CancellationToken ct);
}

public class StorageOptions
{
    public string ServiceUrl { get; set; } = "http://localhost:8333";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string Bucket { get; set; } = "claim-evidence";
}

/// <summary>
/// S3-compatible storage. Locally this is SeaweedFS in Docker; in a cloud deployment the same code talks to S3.
/// The bucket is private — files are only ever served through the API, after an ownership check.
/// </summary>
public class S3ObjectStorage(StorageOptions options, ILogger<S3ObjectStorage> logger) : IObjectStorage, IDisposable
{
    private readonly AmazonS3Client _s3 = new(options.AccessKey, options.SecretKey, new AmazonS3Config
    {
        ServiceURL = options.ServiceUrl,
        ForcePathStyle = true, // local S3-compatible stores use path-style URLs
        AuthenticationRegion = "us-east-1"
    });
    private volatile bool _bucketReady;

    public async Task PutAsync(string key, byte[] bytes, string contentType, CancellationToken ct)
    {
        await EnsureBucketAsync(ct);
        using var ms = new MemoryStream(bytes);
        await _s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = options.Bucket,
            Key = key,
            InputStream = ms,
            ContentType = contentType
        }, ct);
    }

    public async Task<Stream> OpenReadAsync(string key, CancellationToken ct)
    {
        var res = await _s3.GetObjectAsync(options.Bucket, key, ct);
        return res.ResponseStream;
    }

    public async Task DeleteAsync(string key, CancellationToken ct)
    {
        try { await _s3.DeleteObjectAsync(options.Bucket, key, ct); }
        catch (Exception ex) { logger.LogWarning(ex, "Could not delete orphaned object {Key}", key); }
    }

    private async Task EnsureBucketAsync(CancellationToken ct)
    {
        if (_bucketReady) return;
        try { await _s3.PutBucketAsync(options.Bucket, ct); }
        catch (AmazonS3Exception ex) when (ex.ErrorCode is "BucketAlreadyOwnedByYou" or "BucketAlreadyExists") { }
        _bucketReady = true;
    }

    public void Dispose() => _s3.Dispose();
}
