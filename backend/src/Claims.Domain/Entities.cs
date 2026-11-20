namespace Claims.Domain;

public class DomainException(string message) : Exception(message);

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string FullName { get; set; } = "";
    public UserRole Role { get; set; }

    public bool IsStaff => Role is UserRole.ClaimsOfficer or UserRole.Manager;
}

public class InformationRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ClaimId { get; set; }
    public Guid RequestedById { get; set; }
    public string Question { get; set; } = "";
    public string? Response { get; set; }
    public DateTime RequestedAt { get; set; }
    public DateTime? RespondedAt { get; set; }

    public bool IsPending => RespondedAt is null;
}

/// <summary>
/// Timeline / audit entry. Written in the same DB transaction as the change it describes,
/// and also published to Kafka after commit.
/// </summary>
public class ClaimEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ClaimId { get; set; }
    public Guid ActorId { get; set; }
    public string EventType { get; set; } = "";
    public ClaimStatus? FromStatus { get; set; }
    public ClaimStatus ToStatus { get; set; }
    public string? Note { get; set; }
    public DateTime OccurredAt { get; set; }
}

/// <summary>
/// Photo evidence attached to a claim. The bytes live in object storage under <see cref="StorageKey"/>;
/// this row holds the metadata and is what authorisation is checked against.
/// </summary>
public class ClaimAttachment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ClaimId { get; set; }
    public Guid UploadedById { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }
    public string StorageKey { get; set; } = "";
    public DateTime UploadedAt { get; set; }
}

/// <summary>A validated, sanitised file ready to be attached (bytes already stored).</summary>
public record NewAttachment(Guid Id, string FileName, string ContentType, long SizeBytes, string StorageKey);

public class Notification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ClaimId { get; set; }
    public Guid SourceEventId { get; set; }   // idempotency: one notification per user per event
    public string Message { get; set; } = "";
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; }
}
