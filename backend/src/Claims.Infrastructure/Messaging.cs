using System.Text.Json;
using System.Text.Json.Serialization;
using Claims.Domain;
using Confluent.Kafka;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Claims.Infrastructure;

public static class Topics
{
    public const string ClaimEvents = "claims.events";
}

/// <summary>Contract for messages on the claims.events topic.</summary>
public record ClaimEventMessage(
    Guid EventId,
    string EventType,
    Guid ClaimId,
    string ClaimNumber,
    Guid ClaimantId,
    Guid? AssignedOfficerId,
    ClaimStatus Status,
    Guid ActorId,
    string? Note,
    DateTime OccurredAt);

public static class MessageJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };
}

public interface IEventPublisher
{
    Task PublishAsync(IReadOnlyCollection<ClaimEventMessage> messages, CancellationToken ct = default);
}

public sealed class NoOpEventPublisher : IEventPublisher
{
    public Task PublishAsync(IReadOnlyCollection<ClaimEventMessage> messages, CancellationToken ct = default) => Task.CompletedTask;
}

/// <summary>
/// Publishes claim events after the DB transaction has committed.
/// Failures are logged, not thrown: the user's action already succeeded and side effects
/// (notifications) must not undo it. Trade-off: an event can be lost if Kafka is down at
/// that instant — the production fix is a transactional outbox.
/// </summary>
public sealed class KafkaEventPublisher : IEventPublisher, IDisposable
{
    private readonly IProducer<string, string> _producer;
    private readonly ILogger<KafkaEventPublisher> _logger;

    public KafkaEventPublisher(IConfiguration config, ILogger<KafkaEventPublisher> logger)
    {
        _logger = logger;
        _producer = new ProducerBuilder<string, string>(new ProducerConfig
        {
            BootstrapServers = config["Kafka:BootstrapServers"] ?? "localhost:9092",
            Acks = Acks.All,
            EnableIdempotence = true,
            MessageTimeoutMs = 5000 // don't hang the HTTP request if Kafka is down
        }).Build();
    }

    public async Task PublishAsync(IReadOnlyCollection<ClaimEventMessage> messages, CancellationToken ct = default)
    {
        foreach (var m in messages)
        {
            try
            {
                // Key = ClaimId → all events for one claim land on the same partition, in order.
                await _producer.ProduceAsync(Topics.ClaimEvents, new Message<string, string>
                {
                    Key = m.ClaimId.ToString(),
                    Value = JsonSerializer.Serialize(m, MessageJson.Options)
                }, ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to publish {EventType} for claim {ClaimNumber}", m.EventType, m.ClaimNumber);
            }
        }
    }

    public void Dispose()
    {
        _producer.Flush(TimeSpan.FromSeconds(2));
        _producer.Dispose();
    }
}
