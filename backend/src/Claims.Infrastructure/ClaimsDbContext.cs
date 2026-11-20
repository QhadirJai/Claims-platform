using Claims.Domain;
using Microsoft.EntityFrameworkCore;

namespace Claims.Infrastructure;

public class ClaimsDbContext(DbContextOptions<ClaimsDbContext> options, IEventPublisher publisher) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Claim> Claims => Set<Claim>();
    public DbSet<InformationRequest> InformationRequests => Set<InformationRequest>();
    public DbSet<ClaimEvent> ClaimEvents => Set<ClaimEvent>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<ClaimAttachment> ClaimAttachments => Set<ClaimAttachment>();

    /// <summary>
    /// Saves, then publishes any newly added ClaimEvents to Kafka.
    /// Publishing happens only after a successful commit, so we never announce a change that was rolled back.
    /// </summary>
    public override async Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        var newEvents = ChangeTracker.Entries<ClaimEvent>()
            .Where(e => e.State == EntityState.Added)
            .Select(e => e.Entity)
            .ToList();

        var claimsById = ChangeTracker.Entries<Claim>().ToDictionary(e => e.Entity.Id, e => e.Entity);

        var result = await base.SaveChangesAsync(ct);

        if (newEvents.Count > 0)
        {
            var messages = newEvents
                .Where(e => claimsById.ContainsKey(e.ClaimId))
                .OrderBy(e => e.OccurredAt)
                .Select(e =>
                {
                    var c = claimsById[e.ClaimId];
                    return new ClaimEventMessage(e.Id, e.EventType, c.Id, c.ClaimNumber, c.ClaimantId,
                        c.AssignedOfficerId, e.ToStatus, e.ActorId, e.Note, e.OccurredAt);
                })
                .ToList();
            await publisher.PublishAsync(messages, ct);
        }

        return result;
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Ids are generated in the domain (Guid.NewGuid()). Telling EF "never generated" means new
        // children added to a loaded aggregate (events, info requests) are INSERTed, not UPDATEd.
        b.Entity<User>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<Claim>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<InformationRequest>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<ClaimEvent>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<Notification>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<ClaimAttachment>().Property(x => x.Id).ValueGeneratedNever();

        b.Entity<User>(e =>
        {
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.Email).HasMaxLength(200);
            e.Property(u => u.FullName).HasMaxLength(200);
            e.Property(u => u.Role).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<Claim>(e =>
        {
            e.HasIndex(c => c.ClaimNumber).IsUnique();
            e.HasIndex(c => c.Status);
            e.HasIndex(c => c.AssignedOfficerId);
            e.HasIndex(c => c.ClaimantId);

            e.Property(c => c.ClaimNumber).HasMaxLength(30);
            e.Property(c => c.PolicyNumber).HasMaxLength(50);
            e.Property(c => c.Location).HasMaxLength(300);
            e.Property(c => c.Description).HasMaxLength(4000);
            e.Property(c => c.Type).HasConversion<string>().HasMaxLength(20);
            e.Property(c => c.Market).HasConversion<string>().HasMaxLength(5);
            e.Property(c => c.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(c => c.ClaimedAmount).HasPrecision(18, 2);
            e.Property(c => c.ReserveAmount).HasPrecision(18, 2);
            e.Property(c => c.ApprovedAmount).HasPrecision(18, 2);

            // Postgres xmin system column as optimistic concurrency token
            e.Property(c => c.Version).IsRowVersion();

            e.HasOne(c => c.Claimant).WithMany().HasForeignKey(c => c.ClaimantId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(c => c.AssignedOfficer).WithMany().HasForeignKey(c => c.AssignedOfficerId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(c => c.InformationRequests).WithOne().HasForeignKey(r => r.ClaimId);
            e.HasMany(c => c.Events).WithOne().HasForeignKey(ev => ev.ClaimId);
            e.HasMany(c => c.Attachments).WithOne().HasForeignKey(a => a.ClaimId);
            e.Ignore(c => c.IsOpen);
            e.Ignore(c => c.OutstandingExposure);
        });

        b.Entity<InformationRequest>(e =>
        {
            e.Property(r => r.Question).HasMaxLength(2000);
            e.Property(r => r.Response).HasMaxLength(4000);
        });

        b.Entity<ClaimEvent>(e =>
        {
            e.HasIndex(ev => new { ev.ClaimId, ev.OccurredAt });
            e.Property(ev => ev.EventType).HasMaxLength(50);
            e.Property(ev => ev.FromStatus).HasConversion<string>().HasMaxLength(20);
            e.Property(ev => ev.ToStatus).HasConversion<string>().HasMaxLength(20);
            e.Property(ev => ev.Note).HasMaxLength(2000);
        });

        b.Entity<ClaimAttachment>(e =>
        {
            e.HasIndex(a => a.ClaimId);
            e.HasIndex(a => a.StorageKey).IsUnique();
            e.Property(a => a.FileName).HasMaxLength(100);
            e.Property(a => a.ContentType).HasMaxLength(50);
            e.Property(a => a.StorageKey).HasMaxLength(200);
        });

        b.Entity<Notification>(e =>
        {
            // Idempotency for at-least-once Kafka delivery
            e.HasIndex(n => new { n.UserId, n.SourceEventId }).IsUnique();
            e.HasIndex(n => new { n.UserId, n.CreatedAt });
            e.Property(n => n.Message).HasMaxLength(1000);
        });
    }
}
