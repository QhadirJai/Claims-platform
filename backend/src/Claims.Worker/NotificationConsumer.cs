using System.Text.Json;
using Claims.Domain;
using Claims.Infrastructure;
using Confluent.Kafka;
using Microsoft.EntityFrameworkCore;

namespace Claims.Worker;

/// <summary>
/// Consumes claims.events and writes in-app notifications.
///
/// Delivery semantics: at-least-once. Offsets are committed manually *after* the DB write,
/// so a crash between the two causes redelivery, never loss. Redelivery is made harmless by
/// the unique (UserId, SourceEventId) index — the handler is idempotent.
/// </summary>
public class NotificationConsumer(IServiceScopeFactory scopes, IConfiguration config, ILogger<NotificationConsumer> logger)
    : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        // Consume() blocks; run on its own thread so host startup isn't blocked.
        Task.Run(() => RunAsync(stoppingToken), stoppingToken);

    private async Task RunAsync(CancellationToken ct)
    {
        using var consumer = new ConsumerBuilder<string, string>(new ConsumerConfig
        {
            BootstrapServers = config["Kafka:BootstrapServers"] ?? "localhost:9092",
            GroupId = "notification-service",
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = false
        }).Build();

        consumer.Subscribe(Topics.ClaimEvents);
        logger.LogInformation("Notification consumer subscribed to {Topic}", Topics.ClaimEvents);

        while (!ct.IsCancellationRequested)
        {
            ConsumeResult<string, string>? result = null;
            try
            {
                result = consumer.Consume(TimeSpan.FromSeconds(1));
                if (result is null) continue;

                var message = JsonSerializer.Deserialize<ClaimEventMessage>(result.Message.Value, MessageJson.Options);
                if (message is null)
                {
                    logger.LogWarning("Skipping empty message at {Offset}", result.TopicPartitionOffset);
                }
                else
                {
                    await HandleAsync(message, ct);
                }
                consumer.Commit(result);
            }
            catch (JsonException ex) when (result is not null)
            {
                // Poison message: log and skip so one bad message can't block the partition.
                // Production: route to a dead-letter topic instead.
                logger.LogError(ex, "Unreadable message at {Offset}; skipping", result.TopicPartitionOffset);
                consumer.Commit(result);
            }
            catch (ConsumeException ex) when (ex.Error.Code == ErrorCode.UnknownTopicOrPart)
            {
                // Topic not created yet (API hasn't published anything). Wait and retry.
                await Task.Delay(2000, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // Transient failure (e.g. DB down): don't commit; rewind and retry the same message.
                logger.LogError(ex, "Failed handling message; will retry");
                if (result is not null) consumer.Seek(result.TopicPartitionOffset);
                await Task.Delay(2000, ct);
            }
        }

        consumer.Close();
    }

    private async Task HandleAsync(ClaimEventMessage m, CancellationToken ct)
    {
        var targets = BuildNotifications(m);
        if (targets.Count == 0) return;

        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClaimsDbContext>();

        var userIds = targets.Select(t => t.UserId).ToList();
        var already = await db.Notifications
            .Where(n => n.SourceEventId == m.EventId && userIds.Contains(n.UserId))
            .Select(n => n.UserId)
            .ToListAsync(ct);

        var fresh = targets.Where(t => !already.Contains(t.UserId)).ToList();
        if (fresh.Count == 0)
        {
            logger.LogInformation("Duplicate {EventType} {EventId} ignored", m.EventType, m.EventId);
            return;
        }

        db.Notifications.AddRange(fresh);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("{EventType} on {ClaimNumber} → {Count} notification(s)", m.EventType, m.ClaimNumber, fresh.Count);
    }

    /// <summary>Who needs to know about each event.</summary>
    public static List<Notification> BuildNotifications(ClaimEventMessage m)
    {
        var list = new List<Notification>();
        void To(Guid? user, string text)
        {
            if (user is null) return;
            list.Add(new Notification
            {
                UserId = user.Value,
                ClaimId = m.ClaimId,
                SourceEventId = m.EventId,
                Message = text,
                CreatedAt = m.OccurredAt
            });
        }

        switch (m.EventType)
        {
            case ClaimEventTypes.Submitted:
                To(m.ClaimantId, $"We've received your claim {m.ClaimNumber}.");
                break;
            case ClaimEventTypes.Assigned:
                To(m.ClaimantId, $"Your claim {m.ClaimNumber} is now being reviewed by a claims officer.");
                break;
            case ClaimEventTypes.InfoRequested:
                To(m.ClaimantId, $"More information is needed for claim {m.ClaimNumber}: {m.Note}");
                break;
            case ClaimEventTypes.InfoProvided:
                To(m.AssignedOfficerId, $"The claimant responded to your information request on {m.ClaimNumber}.");
                break;
            case ClaimEventTypes.Approved:
                To(m.ClaimantId, $"Good news — claim {m.ClaimNumber} has been approved. {m.Note}.");
                break;
            case ClaimEventTypes.Rejected:
                To(m.ClaimantId, $"Claim {m.ClaimNumber} was not approved. Reason: {m.Note}");
                break;
            case ClaimEventTypes.Settled:
                To(m.ClaimantId, $"Claim {m.ClaimNumber} has been settled. {m.Note}.");
                break;
            // ReserveSet is internal — no claimant notification by design.
        }
        return list;
    }
}
