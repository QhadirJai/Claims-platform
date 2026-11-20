using Claims.Api.Security;
using Claims.Domain;
using Claims.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Claims.Api.Controllers;

[ApiController]
[Route("api/staff/dashboard")]
[Authorize(Policy = Policies.Staff)]
public class DashboardController(ClaimsDbContext db, TimeProvider clock) : ControllerBase
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    /// <summary>Team workload: what each officer holds, how old it is, and recent throughput.</summary>
    [HttpGet("workload")]
    public async Task<WorkloadDto> Workload()
    {
        var since = Now.AddDays(-30);
        var claims = await db.Claims.AsNoTracking()
            .Where(c => Claim.OpenStatuses.Contains(c.Status) || c.ClosedAt >= since)
            .Select(c => new { c.AssignedOfficerId, c.Status, c.CreatedAt, c.ClosedAt })
            .ToListAsync();

        var officers = await db.Users.AsNoTracking()
            .Where(u => u.Role == UserRole.ClaimsOfficer || u.Role == UserRole.Manager)
            .OrderBy(u => u.FullName)
            .ToListAsync();

        int Age(DateTime created) => (int)(Now - created).TotalDays;

        var unassigned = claims.Where(c => c.AssignedOfficerId == null && c.Status == ClaimStatus.Submitted).ToList();

        var rows = officers.Select(o =>
        {
            var mine = claims.Where(c => c.AssignedOfficerId == o.Id).ToList();
            var open = mine.Where(c => Claim.OpenStatuses.Contains(c.Status)).ToList();
            var closed = mine.Where(c => c.ClosedAt != null).ToList();
            return new OfficerWorkloadDto(
                o.Id, o.FullName,
                open.Count,
                open.Count(c => c.Status == ClaimStatus.UnderReview),
                open.Count(c => c.Status == ClaimStatus.InfoRequested),
                open.Count(c => c.Status == ClaimStatus.Approved),
                open.Count == 0 ? 0 : open.Max(c => Age(c.CreatedAt)),
                closed.Count,
                closed.Count == 0 ? null : Math.Round(closed.Average(c => (c.ClosedAt!.Value - c.CreatedAt).TotalDays), 1));
        }).ToList();

        return new WorkloadDto(
            unassigned.Count,
            unassigned.Count == 0 ? 0 : unassigned.Max(c => Age(c.CreatedAt)),
            claims.Count(c => Claim.OpenStatuses.Contains(c.Status)),
            rows);
    }

    /// <summary>
    /// Outstanding liability exposure by market and claim type. Managers only.
    /// Uses Claim.OutstandingExposure so the rule is defined once, in the domain.
    /// </summary>
    [HttpGet("exposure")]
    [Authorize(Policy = Policies.Manager)]
    public async Task<ExposureDto> Exposure()
    {
        var open = await db.Claims.AsNoTracking()
            .Where(c => Claim.OpenStatuses.Contains(c.Status))
            .ToListAsync();

        var buckets = open
            .GroupBy(c => new { c.Market, c.Type })
            .Select(g =>
            {
                var assessing = g.Where(c => c.Status != ClaimStatus.Approved).ToList();
                var reserved = assessing.Where(c => c.ReserveAmount != null).Sum(c => c.OutstandingExposure);
                var unreserved = assessing.Where(c => c.ReserveAmount == null).Sum(c => c.OutstandingExposure);
                var approved = g.Where(c => c.Status == ClaimStatus.Approved).Sum(c => c.OutstandingExposure);
                return new ExposureBucketDto(g.Key.Market.ToString(), g.Key.Type.ToString(), g.Count(),
                    reserved, unreserved, approved, reserved + unreserved + approved);
            })
            .OrderByDescending(b => b.Total)
            .ToList();

        return new ExposureDto(buckets.Sum(b => b.Total), open.Count, buckets);
    }
}
