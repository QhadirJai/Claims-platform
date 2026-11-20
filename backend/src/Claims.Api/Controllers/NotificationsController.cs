using Claims.Api.Security;
using Claims.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Claims.Api.Controllers;

/// <summary>Notifications are produced asynchronously by Claims.Worker from Kafka events.</summary>
[ApiController]
[Route("api/notifications")]
public class NotificationsController(ClaimsDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<NotificationDto>> List()
    {
        var me = User.Id();
        return await db.Notifications.AsNoTracking()
            .Where(n => n.UserId == me)
            .OrderByDescending(n => n.CreatedAt)
            .Take(50)
            .Select(n => new NotificationDto(n.Id, n.ClaimId, n.Message, n.IsRead, n.CreatedAt))
            .ToListAsync();
    }

    /// <summary>Cheap enough to poll: one indexed count on (UserId, CreatedAt).</summary>
    [HttpGet("unread-count")]
    public async Task<UnreadCountDto> UnreadCount()
    {
        var me = User.Id();
        return new UnreadCountDto(await db.Notifications.CountAsync(n => n.UserId == me && !n.IsRead));
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllRead()
    {
        var me = User.Id();
        await db.Notifications
            .Where(n => n.UserId == me && !n.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true));
        return NoContent();
    }

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid id)
    {
        var me = User.Id();
        var updated = await db.Notifications
            .Where(n => n.Id == id && n.UserId == me)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true));
        return updated == 0 ? NotFound() : NoContent();
    }
}
