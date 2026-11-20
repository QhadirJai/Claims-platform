using Claims.Api.Security;
using Claims.Domain;
using Claims.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Claims.Api.Controllers;

/// <summary>
/// Claimant-facing endpoints.
/// Ownership rule: every query is filtered by the caller's id taken from the JWT, never from the request.
/// A claim that exists but belongs to someone else returns 404 (not 403) so its existence isn't leaked.
/// </summary>
[ApiController]
[Route("api/claims")]
[Authorize(Policy = Policies.Claimant)]
public class ClaimsController(ClaimsDbContext db, TimeProvider clock) : ControllerBase
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    [HttpPost]
    public async Task<ActionResult<ClaimDetailDto>> Submit(SubmitClaimRequest req)
    {
        var claim = Claim.Submit(User.Id(), req.Type, req.Market, req.PolicyNumber, req.IncidentDate,
            req.Location, req.Description, req.ClaimedAmount, Now);
        db.Claims.Add(claim);
        await db.SaveChangesAsync();

        var created = await LoadOwn(claim.Id);
        return CreatedAtAction(nameof(Get), new { id = claim.Id }, ForClaimant(created!));
    }

    [HttpGet("mine")]
    public async Task<IReadOnlyList<ClaimSummaryDto>> Mine()
    {
        var userId = User.Id();
        var claims = await db.Claims.AsNoTracking()
            .Include(c => c.Claimant).Include(c => c.AssignedOfficer)
            .Where(c => c.ClaimantId == userId)
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync();
        // Reserve is internal to the insurer — never expose it to claimants.
        return claims.Select(c => c.ToSummary(Now) with { ReserveAmount = null }).ToList();
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ClaimDetailDto>> Get(Guid id)
    {
        var claim = await LoadOwn(id, tracking: false);
        return claim is null ? NotFound() : ForClaimant(claim);
    }

    [HttpPost("{id:guid}/info-requests/{requestId:guid}/response")]
    public async Task<ActionResult<ClaimDetailDto>> Respond(Guid id, Guid requestId, RespondRequest req)
    {
        var claim = await LoadOwn(id);
        if (claim is null) return NotFound();

        claim.RespondToInformationRequest(requestId, req.Response, User.Id(), Now);
        await db.SaveChangesAsync();
        return ForClaimant(claim);
    }

    private Task<Claim?> LoadOwn(Guid id, bool tracking = true)
    {
        var userId = User.Id();
        var q = db.Claims
            .Include(c => c.Claimant).Include(c => c.AssignedOfficer)
            .Include(c => c.InformationRequests).Include(c => c.Events)
            .AsSplitQuery()
            .Where(c => c.Id == id && c.ClaimantId == userId);
        return (tracking ? q : q.AsNoTracking()).SingleOrDefaultAsync();
    }

    /// <summary>Claimant view: hide internal reserve and reserve-change timeline entries.</summary>
    private static ClaimDetailDto ForClaimant(Claim c)
    {
        var dto = c.ToDetail();
        return dto with
        {
            ReserveAmount = null,
            Timeline = dto.Timeline.Where(t => t.EventType != ClaimEventTypes.ReserveSet).ToList()
        };
    }
}
