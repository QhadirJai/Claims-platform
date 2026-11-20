namespace Claims.Domain;

/// <summary>
/// Claim aggregate. All status changes go through methods on this class so the
/// lifecycle rules live in exactly one place:
///
///   Submitted ─assign─► UnderReview ─request info─► InfoRequested
///                          ▲   │                        │
///                          │   └──── respond ◄──────────┘
///              UnderReview ─┼─approve─► Approved ─settle─► Settled
///                           └─reject──► Rejected
/// </summary>
public class Claim
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public string ClaimNumber { get; private set; } = "";
    public Guid ClaimantId { get; private set; }
    public Guid? AssignedOfficerId { get; private set; }
    public ClaimType Type { get; private set; }
    public Market Market { get; private set; }
    public string PolicyNumber { get; private set; } = "";
    public DateOnly IncidentDate { get; private set; }
    public string Location { get; private set; } = "";
    public string Description { get; private set; } = "";
    public decimal ClaimedAmount { get; private set; }
    public decimal? ReserveAmount { get; private set; }
    public decimal? ApprovedAmount { get; private set; }
    public string? RejectionReason { get; private set; }
    public ClaimStatus Status { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }
    public DateTime? ClosedAt { get; private set; }

    /// <summary>Optimistic concurrency token (mapped to Postgres xmin).</summary>
    public uint Version { get; private set; }

    public User? Claimant { get; private set; }
    public User? AssignedOfficer { get; private set; }
    public List<InformationRequest> InformationRequests { get; private set; } = [];
    public List<ClaimEvent> Events { get; private set; } = [];
    public List<ClaimAttachment> Attachments { get; private set; } = [];

    public const int MaxAttachments = 10;

    private Claim() { } // EF

    public static readonly ClaimStatus[] OpenStatuses =
        [ClaimStatus.Submitted, ClaimStatus.UnderReview, ClaimStatus.InfoRequested, ClaimStatus.Approved];

    public bool IsOpen => OpenStatuses.Contains(Status);

    /// <summary>
    /// Outstanding liability for this claim.
    /// Approved → the approved amount (payment still owed).
    /// Other open statuses → the reserve, or the claimed amount if no reserve has been set yet.
    /// Closed → 0.
    /// </summary>
    public decimal OutstandingExposure => Status switch
    {
        ClaimStatus.Approved => ApprovedAmount ?? 0,
        ClaimStatus.Submitted or ClaimStatus.UnderReview or ClaimStatus.InfoRequested
            => ReserveAmount ?? ClaimedAmount,
        _ => 0
    };

    public static Claim Submit(
        Guid claimantId, ClaimType type, Market market, string policyNumber,
        DateOnly incidentDate, string location, string description, decimal claimedAmount,
        DateTime now)
    {
        if (claimedAmount <= 0) throw new DomainException("Claimed amount must be greater than zero.");
        if (incidentDate > DateOnly.FromDateTime(now)) throw new DomainException("Incident date cannot be in the future.");
        if (string.IsNullOrWhiteSpace(policyNumber)) throw new DomainException("Policy number is required.");
        if (string.IsNullOrWhiteSpace(description)) throw new DomainException("Description is required.");

        var claim = new Claim
        {
            ClaimNumber = $"CLM-{now:yyyyMMdd}-{Random.Shared.Next(100000, 999999)}",
            ClaimantId = claimantId,
            Type = type,
            Market = market,
            PolicyNumber = policyNumber.Trim(),
            IncidentDate = incidentDate,
            Location = location.Trim(),
            Description = description.Trim(),
            ClaimedAmount = claimedAmount,
            Status = ClaimStatus.Submitted,
            CreatedAt = now,
            UpdatedAt = now
        };
        claim.Record(ClaimEventTypes.Submitted, claimantId, null, now, $"Claim submitted for {claimedAmount:N2}");
        return claim;
    }

    public void AssignTo(Guid officerId, Guid actorId, DateTime now)
    {
        if (Status != ClaimStatus.Submitted)
            throw new DomainException($"Only submitted claims can be picked up (current status: {Status}).");

        var from = Status;
        AssignedOfficerId = officerId;
        Status = ClaimStatus.UnderReview;
        Record(ClaimEventTypes.Assigned, actorId, from, now, "Claim picked up for review");
    }

    public void SetReserve(decimal amount, Guid actorId, bool actorIsManager, DateTime now)
    {
        EnsureHandledBy(actorId, actorIsManager);
        if (Status is not (ClaimStatus.UnderReview or ClaimStatus.InfoRequested))
            throw new DomainException($"Reserve can only be set while the claim is being assessed (current status: {Status}).");
        if (amount < 0) throw new DomainException("Reserve cannot be negative.");

        ReserveAmount = amount;
        Record(ClaimEventTypes.ReserveSet, actorId, Status, now, $"Reserve set to {amount:N2}");
    }

    public InformationRequest RequestInformation(string question, Guid actorId, bool actorIsManager, DateTime now)
    {
        EnsureHandledBy(actorId, actorIsManager);
        if (Status != ClaimStatus.UnderReview)
            throw new DomainException($"Information can only be requested while under review (current status: {Status}).");
        if (string.IsNullOrWhiteSpace(question)) throw new DomainException("Question is required.");

        var request = new InformationRequest
        {
            ClaimId = Id,
            RequestedById = actorId,
            Question = question.Trim(),
            RequestedAt = now
        };
        InformationRequests.Add(request);

        var from = Status;
        Status = ClaimStatus.InfoRequested;
        Record(ClaimEventTypes.InfoRequested, actorId, from, now, request.Question);
        return request;
    }

    public void RespondToInformationRequest(Guid requestId, string response, Guid claimantId, DateTime now)
    {
        if (claimantId != ClaimantId) throw new DomainException("Only the claimant can respond to this request.");
        if (Status != ClaimStatus.InfoRequested)
            throw new DomainException($"There is no outstanding information request (current status: {Status}).");

        var request = InformationRequests.FirstOrDefault(r => r.Id == requestId)
            ?? throw new DomainException("Information request not found.");
        if (!request.IsPending) throw new DomainException("This request has already been answered.");
        if (string.IsNullOrWhiteSpace(response)) throw new DomainException("Response is required.");

        request.Response = response.Trim();
        request.RespondedAt = now;

        var from = Status;
        Status = ClaimStatus.UnderReview;
        Record(ClaimEventTypes.InfoProvided, claimantId, from, now, "Claimant provided the requested information");
    }

    public void Approve(decimal amount, Guid actorId, bool actorIsManager, DateTime now)
    {
        EnsureHandledBy(actorId, actorIsManager);
        if (Status != ClaimStatus.UnderReview)
            throw new DomainException($"Only claims under review can be approved (current status: {Status}).");
        if (amount <= 0) throw new DomainException("Approved amount must be greater than zero.");
        if (amount > ClaimedAmount) throw new DomainException("Approved amount cannot exceed the claimed amount.");

        var from = Status;
        ApprovedAmount = amount;
        Status = ClaimStatus.Approved;
        Record(ClaimEventTypes.Approved, actorId, from, now, $"Approved for {amount:N2}");
    }

    public void Reject(string reason, Guid actorId, bool actorIsManager, DateTime now)
    {
        EnsureHandledBy(actorId, actorIsManager);
        if (Status != ClaimStatus.UnderReview)
            throw new DomainException($"Only claims under review can be rejected (current status: {Status}).");
        if (string.IsNullOrWhiteSpace(reason)) throw new DomainException("A rejection reason is required.");

        var from = Status;
        RejectionReason = reason.Trim();
        Status = ClaimStatus.Rejected;
        ClosedAt = now;
        Record(ClaimEventTypes.Rejected, actorId, from, now, RejectionReason);
    }

    public void Settle(Guid actorId, bool actorIsManager, DateTime now)
    {
        EnsureHandledBy(actorId, actorIsManager);
        if (Status != ClaimStatus.Approved)
            throw new DomainException($"Only approved claims can be settled (current status: {Status}).");

        var from = Status;
        Status = ClaimStatus.Settled;
        ClosedAt = now;
        Record(ClaimEventTypes.Settled, actorId, from, now, $"Settled for {ApprovedAmount:N2}");
    }

    /// <summary>
    /// Claimant adds photo evidence. Allowed while the claim is still being decided, so photos can
    /// accompany the first report or answer an information request. One timeline event per batch.
    /// </summary>
    public void AddAttachments(IReadOnlyList<NewAttachment> files, Guid claimantId, DateTime now)
    {
        if (claimantId != ClaimantId) throw new DomainException("Only the claimant can add photos to this claim.");
        if (Status is not (ClaimStatus.Submitted or ClaimStatus.UnderReview or ClaimStatus.InfoRequested))
            throw new DomainException($"Photos can only be added before a decision is made (current status: {Status}).");
        if (files.Count == 0) throw new DomainException("No photos were provided.");
        if (Attachments.Count + files.Count > MaxAttachments)
            throw new DomainException($"A claim can have at most {MaxAttachments} photos ({Attachments.Count} already attached).");

        foreach (var f in files)
        {
            Attachments.Add(new ClaimAttachment
            {
                Id = f.Id,
                ClaimId = Id,
                UploadedById = claimantId,
                FileName = f.FileName,
                ContentType = f.ContentType,
                SizeBytes = f.SizeBytes,
                StorageKey = f.StorageKey,
                UploadedAt = now
            });
        }
        Record(ClaimEventTypes.EvidenceAdded, claimantId, Status, now,
            files.Count == 1 ? "1 photo added" : $"{files.Count} photos added");
    }

    /// <summary>Only the assigned officer (or a manager) may act on a claim.</summary>
    private void EnsureHandledBy(Guid actorId, bool actorIsManager)
    {
        if (AssignedOfficerId is null) throw new DomainException("Claim must be picked up first.");
        if (!actorIsManager && AssignedOfficerId != actorId)
            throw new DomainException("Only the assigned officer or a manager can act on this claim.");
    }

    private void Record(string type, Guid actorId, ClaimStatus? from, DateTime now, string? note)
    {
        UpdatedAt = now;
        Events.Add(new ClaimEvent
        {
            ClaimId = Id,
            ActorId = actorId,
            EventType = type,
            FromStatus = from,
            ToStatus = Status,
            Note = note,
            OccurredAt = now
        });
    }
}
