using Claims.Domain;
using Claims.Infrastructure;
using Claims.Worker;

namespace Claims.Tests;

public class NotificationRoutingTests
{
    private static ClaimEventMessage Msg(string type, Guid claimant, Guid? officer) =>
        new(Guid.NewGuid(), type, Guid.NewGuid(), "CLM-1", claimant, officer, ClaimStatus.UnderReview,
            Guid.NewGuid(), "note", DateTime.UtcNow);

    [Fact]
    public void Reserve_changes_are_never_sent_to_the_claimant() =>
        Assert.Empty(NotificationConsumer.BuildNotifications(Msg(ClaimEventTypes.ReserveSet, Guid.NewGuid(), Guid.NewGuid())));

    [Fact]
    public void Info_provided_notifies_the_assigned_officer_only()
    {
        var claimant = Guid.NewGuid();
        var officer = Guid.NewGuid();
        var n = Assert.Single(NotificationConsumer.BuildNotifications(Msg(ClaimEventTypes.InfoProvided, claimant, officer)));
        Assert.Equal(officer, n.UserId);
    }

    [Fact]
    public void Notifications_carry_source_event_id_for_idempotency()
    {
        var m = Msg(ClaimEventTypes.Approved, Guid.NewGuid(), Guid.NewGuid());
        var n = Assert.Single(NotificationConsumer.BuildNotifications(m));
        Assert.Equal(m.EventId, n.SourceEventId);
    }
}
