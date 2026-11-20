using System.ComponentModel.DataAnnotations;
using Claims.Domain;

namespace Claims.Api;

// ── Auth ─────────────────────────────────────────────────────────────
public record LoginRequest([Required, EmailAddress] string Email, [Required] string Password);
public record UserDto(Guid Id, string Email, string FullName, UserRole Role);
public record LoginResponse(string Token, DateTime ExpiresAt, UserDto User);

// ── Claims ───────────────────────────────────────────────────────────
public record SubmitClaimRequest(
    [Required] ClaimType Type,
    [Required] Market Market,
    [Required, StringLength(50)] string PolicyNumber,
    [Required] DateOnly IncidentDate,
    [Required, StringLength(300)] string Location,
    [Required, StringLength(4000, MinimumLength = 10)] string Description,
    [Range(0.01, 100_000_000)] decimal ClaimedAmount);

public record ClaimSummaryDto(
    Guid Id, string ClaimNumber, ClaimType Type, Market Market, ClaimStatus Status,
    decimal ClaimedAmount, decimal? ReserveAmount, decimal? ApprovedAmount,
    string ClaimantName, string? AssignedOfficerName, DateTime CreatedAt, DateTime UpdatedAt, int AgeDays,
    int PhotoCount);

public record InformationRequestDto(Guid Id, string Question, string? Response, DateTime RequestedAt, DateTime? RespondedAt);
public record AttachmentDto(Guid Id, string FileName, string ContentType, long SizeBytes, DateTime UploadedAt);
public record TimelineEntryDto(string EventType, ClaimStatus? FromStatus, ClaimStatus ToStatus, string? Note, DateTime OccurredAt);

public record ClaimDetailDto(
    Guid Id, string ClaimNumber, ClaimType Type, Market Market, ClaimStatus Status,
    string PolicyNumber, DateOnly IncidentDate, string Location, string Description,
    decimal ClaimedAmount, decimal? ReserveAmount, decimal? ApprovedAmount, string? RejectionReason,
    string ClaimantName, Guid? AssignedOfficerId, string? AssignedOfficerName,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? ClosedAt,
    IReadOnlyList<InformationRequestDto> InformationRequests,
    IReadOnlyList<TimelineEntryDto> Timeline,
    IReadOnlyList<AttachmentDto> Attachments);

public record RespondRequest([Required, StringLength(4000, MinimumLength = 1)] string Response);
public record ReserveRequest([Range(0, 100_000_000)] decimal Amount);
public record InfoRequestCreate([Required, StringLength(2000, MinimumLength = 5)] string Question);
public record ApproveRequest([Range(0.01, 100_000_000)] decimal Amount);
public record RejectRequest([Required, StringLength(2000, MinimumLength = 5)] string Reason);

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

// ── Dashboards ───────────────────────────────────────────────────────
public record OfficerWorkloadDto(
    Guid OfficerId, string OfficerName, int Open, int UnderReview, int InfoRequested, int Approved,
    int OldestOpenAgeDays, int ClosedLast30Days, double? AvgDaysToClose);

public record WorkloadDto(int Unassigned, int OldestUnassignedAgeDays, int TotalOpen, IReadOnlyList<OfficerWorkloadDto> Officers);

public record ExposureBucketDto(string Market, string Type, int OpenClaims, decimal Reserved, decimal Unreserved, decimal ApprovedUnpaid, decimal Total);
public record ExposureDto(decimal TotalExposure, int OpenClaims, IReadOnlyList<ExposureBucketDto> Buckets);

// ── Notifications ────────────────────────────────────────────────────
public record NotificationDto(Guid Id, Guid ClaimId, string Message, bool IsRead, DateTime CreatedAt);
public record UnreadCountDto(int Count);
