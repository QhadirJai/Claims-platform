using Claims.Domain;

namespace Claims.Tests;

public class ClaimLifecycleTests
{
    private static readonly DateTime Now = new(2026, 11, 20, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid ClaimantId = Guid.NewGuid();
    private static readonly Guid OfficerId = Guid.NewGuid();
    private static readonly Guid OtherOfficerId = Guid.NewGuid();

    private static Claim NewClaim(decimal amount = 10_000m) => Claim.Submit(
        ClaimantId, ClaimType.Motor, Market.SG, "POL-123", new DateOnly(2026, 11, 18),
        "Orchard Rd", "Rear-ended at traffic light", amount, Now);

    private static Claim UnderReview()
    {
        var c = NewClaim();
        c.AssignTo(OfficerId, OfficerId, Now);
        return c;
    }

    [Fact]
    public void Submit_creates_submitted_claim_with_timeline_entry()
    {
        var c = NewClaim();
        Assert.Equal(ClaimStatus.Submitted, c.Status);
        Assert.StartsWith("CLM-20261120-", c.ClaimNumber);
        Assert.Single(c.Events);
        Assert.Equal(ClaimEventTypes.Submitted, c.Events[0].EventType);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void Submit_rejects_non_positive_amount(decimal amount) =>
        Assert.Throws<DomainException>(() => NewClaim(amount));

    [Fact]
    public void Submit_rejects_future_incident_date() =>
        Assert.Throws<DomainException>(() => Claim.Submit(
            ClaimantId, ClaimType.Property, Market.AU, "POL-1", new DateOnly(2026, 12, 1),
            "Sydney", "Flood", 100m, Now));

    [Fact]
    public void Full_happy_path_with_information_request()
    {
        var c = UnderReview();
        var req = c.RequestInformation("Please upload the police report", OfficerId, false, Now);
        Assert.Equal(ClaimStatus.InfoRequested, c.Status);

        c.RespondToInformationRequest(req.Id, "Report ref 998877", ClaimantId, Now);
        Assert.Equal(ClaimStatus.UnderReview, c.Status);

        c.Approve(8_000m, OfficerId, false, Now);
        Assert.Equal(ClaimStatus.Approved, c.Status);

        c.Settle(OfficerId, false, Now);
        Assert.Equal(ClaimStatus.Settled, c.Status);
        Assert.NotNull(c.ClosedAt);
        Assert.Equal(6, c.Events.Count);
    }

    [Fact]
    public void Cannot_pick_up_claim_twice()
    {
        var c = UnderReview();
        Assert.Throws<DomainException>(() => c.AssignTo(OtherOfficerId, OtherOfficerId, Now));
    }

    [Fact]
    public void Cannot_approve_before_pick_up() =>
        Assert.Throws<DomainException>(() => NewClaim().Approve(100m, OfficerId, false, Now));

    [Fact]
    public void Other_officer_cannot_act_but_manager_can()
    {
        var c = UnderReview();
        Assert.Throws<DomainException>(() => c.Approve(100m, OtherOfficerId, false, Now));

        var managerId = Guid.NewGuid();
        c.Approve(100m, managerId, actorIsManager: true, Now);
        Assert.Equal(ClaimStatus.Approved, c.Status);
    }

    [Fact]
    public void Cannot_approve_more_than_claimed() =>
        Assert.Throws<DomainException>(() => UnderReview().Approve(10_001m, OfficerId, false, Now));

    [Fact]
    public void Rejected_claim_cannot_be_approved()
    {
        var c = UnderReview();
        c.Reject("Policy lapsed", OfficerId, false, Now);
        Assert.Throws<DomainException>(() => c.Approve(100m, OfficerId, false, Now));
    }

    [Fact]
    public void Cannot_settle_unapproved_claim() =>
        Assert.Throws<DomainException>(() => UnderReview().Settle(OfficerId, false, Now));

    [Fact]
    public void Only_owning_claimant_can_respond()
    {
        var c = UnderReview();
        var req = c.RequestInformation("Photos?", OfficerId, false, Now);
        Assert.Throws<DomainException>(() => c.RespondToInformationRequest(req.Id, "x", Guid.NewGuid(), Now));
    }

    [Fact]
    public void Exposure_uses_claimed_amount_until_reserve_is_set()
    {
        var c = UnderReview();
        Assert.Equal(10_000m, c.OutstandingExposure);

        c.SetReserve(6_500m, OfficerId, false, Now);
        Assert.Equal(6_500m, c.OutstandingExposure);
    }

    [Fact]
    public void Exposure_is_approved_amount_until_settled_then_zero()
    {
        var c = UnderReview();
        c.Approve(7_000m, OfficerId, false, Now);
        Assert.Equal(7_000m, c.OutstandingExposure);

        c.Settle(OfficerId, false, Now);
        Assert.Equal(0m, c.OutstandingExposure);
    }

    [Fact]
    public void Rejected_claim_has_no_exposure()
    {
        var c = UnderReview();
        c.Reject("Not covered", OfficerId, false, Now);
        Assert.Equal(0m, c.OutstandingExposure);
    }
}
