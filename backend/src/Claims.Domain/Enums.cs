namespace Claims.Domain;

public enum UserRole
{
    Claimant,
    ClaimsOfficer,
    Manager
}

public enum ClaimType
{
    Motor,
    Property
}

/// <summary>Generic market codes for the six APAC markets (illustrative only).</summary>
public enum Market
{
    SG,
    MY,
    HK,
    AU,
    TH,
    ID
}

public enum ClaimStatus
{
    Submitted,
    UnderReview,
    InfoRequested,
    Approved,
    Rejected,
    Settled
}

public static class ClaimEventTypes
{
    public const string Submitted = "ClaimSubmitted";
    public const string Assigned = "ClaimAssigned";
    public const string ReserveSet = "ReserveSet";
    public const string InfoRequested = "InfoRequested";
    public const string InfoProvided = "InfoProvided";
    public const string Approved = "ClaimApproved";
    public const string Rejected = "ClaimRejected";
    public const string Settled = "ClaimSettled";
    public const string EvidenceAdded = "EvidenceAdded";
}
