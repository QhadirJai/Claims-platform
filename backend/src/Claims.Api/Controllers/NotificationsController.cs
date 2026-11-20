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
