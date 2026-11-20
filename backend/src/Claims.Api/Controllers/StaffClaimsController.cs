using Claims.Api.Security;
using Claims.Domain;
using Claims.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Claims.Api.Controllers;

/// <summary>Claims-staff endpoints (officers and managers).</summary>
[ApiController]
[Route("api/staff/claims")]
[Authorize(Policy = Policies.Staff)]
public class StaffClaimsController(ClaimsDbContext db, TimeProvider clock) : ControllerBase
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    /// <param name="scope">mine | unassigned | all (default all)</param>
    [HttpGet]
    public async Task<PagedResult<ClaimSummaryDto>> List(
        [FromQuery] string scope = "all",
        [FromQuery] ClaimStatus? status = null,
        [FromQuery] ClaimType? type = null,
        [FromQuery] Market? market = null,
        [FromQuery] bool openOnly = false,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var me = User.Id();

        var q = db.Claims.AsNoTracking().Include(c => c.Claimant).Include(c => c.AssignedOfficer).AsQueryable();
        q = scope.ToLowerInvariant() switch
        {
            "mine" => q.Where(c => c.AssignedOfficerId == me),
            "unassigned" => q.Where(c => c.AssignedOfficerId == null),
            _ => q
        };
        if (status is not null) q = q.Where(c => c.Status == status);
        if (type is not null) q = q.Where(c => c.Type == type);
        if (market is not null) q = q.Where(c => c.Market == market);
        if (openOnly) q = q.Where(c => Claim.OpenStatuses.Contains(c.Status));

        var total = await q.CountAsync();
        // Oldest first: a work queue should surface what has waited longest.
        var items = await q.OrderBy(c => c.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new PagedResult<ClaimSummaryDto>(items.Select(c => c.ToSummary(Now)).ToList(), total, page, pageSize);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ClaimDetailDto>> Get(Guid id)
    {
        var claim = await Load(id, tracking: false);
        return claim is null ? NotFound() : claim.ToDetail();
    }

    /// <summary>Pick up a claim. Optimistic concurrency (xmin) → 409 if another officer got there first.</summary>
    [HttpPost("{id:guid}/assign")]
    public Task<ActionResult<ClaimDetailDto>> Assign(Guid id) =>
        Act(id, c => c.AssignTo(User.Id(), User.Id(), Now));

    [HttpPut("{id:guid}/reserve")]
    public Task<ActionResult<ClaimDetailDto>> SetReserve(Guid id, ReserveRequest req) =>
        Act(id, c => c.SetReserve(req.Amount, User.Id(), User.IsManager(), Now));

    [HttpPost("{id:guid}/info-requests")]
    public Task<ActionResult<ClaimDetailDto>> RequestInfo(Guid id, InfoRequestCreate req) =>
        Act(id, c => c.RequestInformation(req.Question, User.Id(), User.IsManager(), Now));

    [HttpPost("{id:guid}/approve")]
    public Task<ActionResult<ClaimDetailDto>> Approve(Guid id, ApproveRequest req) =>
        Act(id, c => c.Approve(req.Amount, User.Id(), User.IsManager(), Now));

    [HttpPost("{id:guid}/reject")]
    public Task<ActionResult<ClaimDetailDto>> Reject(Guid id, RejectRequest req) =>
        Act(id, c => c.Reject(req.Reason, User.Id(), User.IsManager(), Now));

    [HttpPost("{id:guid}/settle")]
    public Task<ActionResult<ClaimDetailDto>> Settle(Guid id) =>
        Act(id, c => c.Settle(User.Id(), User.IsManager(), Now));

    /// <summary>Load → apply domain operation → save (+ publish events) → return fresh state.</summary>
    private async Task<ActionResult<ClaimDetailDto>> Act(Guid id, Action<Claim> operation)
    {
        var claim = await Load(id);
        if (claim is null) return NotFound();

        operation(claim);
        await db.SaveChangesAsync();

        var fresh = await Load(id, tracking: false);
        return fresh!.ToDetail();
    }

    private Task<Claim?> Load(Guid id, bool tracking = true)
    {
        var q = db.Claims
            .Include(c => c.Claimant).Include(c => c.AssignedOfficer)
            .Include(c => c.InformationRequests).Include(c => c.Events)
            .AsSplitQuery()
            .Where(c => c.Id == id);
        return (tracking ? q : q.AsNoTracking()).SingleOrDefaultAsync();
    }
}
