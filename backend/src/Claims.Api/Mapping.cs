using Claims.Domain;

namespace Claims.Api;

public static class Mapping
{
    public static UserDto ToDto(this User u) => new(u.Id, u.Email, u.FullName, u.Role);

    public static ClaimSummaryDto ToSummary(this Claim c, DateTime now) => new(
        c.Id, c.ClaimNumber, c.Type, c.Market, c.Status, c.ClaimedAmount, c.ReserveAmount, c.ApprovedAmount,
        c.Claimant?.FullName ?? "", c.AssignedOfficer?.FullName, c.CreatedAt, c.UpdatedAt,
        (int)((c.ClosedAt ?? now) - c.CreatedAt).TotalDays, c.Attachments.Count);

    public static ClaimDetailDto ToDetail(this Claim c) => new(
        c.Id, c.ClaimNumber, c.Type, c.Market, c.Status, c.PolicyNumber, c.IncidentDate, c.Location, c.Description,
        c.ClaimedAmount, c.ReserveAmount, c.ApprovedAmount, c.RejectionReason,
        c.Claimant?.FullName ?? "", c.AssignedOfficerId, c.AssignedOfficer?.FullName,
        c.CreatedAt, c.UpdatedAt, c.ClosedAt,
        c.InformationRequests.OrderBy(r => r.RequestedAt)
            .Select(r => new InformationRequestDto(r.Id, r.Question, r.Response, r.RequestedAt, r.RespondedAt)).ToList(),
        c.Events.OrderBy(e => e.OccurredAt)
            .Select(e => new TimelineEntryDto(e.EventType, e.FromStatus, e.ToStatus, e.Note, e.OccurredAt)).ToList(),
        c.Attachments.OrderBy(a => a.UploadedAt)
            .Select(a => new AttachmentDto(a.Id, a.FileName, a.ContentType, a.SizeBytes, a.UploadedAt)).ToList());
}
