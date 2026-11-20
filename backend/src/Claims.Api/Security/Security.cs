using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using JwtClaim = System.Security.Claims.Claim;
using Claims.Domain;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace Claims.Api.Security;

public static class Policies
{
    public const string Claimant = nameof(Claimant);
    public const string Staff = nameof(Staff);
    public const string Manager = nameof(Manager);
}

public class JwtOptions
{
    public string Issuer { get; set; } = "";
    public string Audience { get; set; } = "";
    public string Key { get; set; } = "";
    public int ExpiryMinutes { get; set; } = 60;
}

public class TokenService(JwtOptions options, TimeProvider clock)
{
    public (string Token, DateTime ExpiresAt) Issue(User user)
    {
        var expires = clock.GetUtcNow().UtcDateTime.AddMinutes(options.ExpiryMinutes);
        var token = new JwtSecurityToken(
            issuer: options.Issuer,
            audience: options.Audience,
            claims:
            [
                new JwtClaim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new JwtClaim(JwtRegisteredClaimNames.Email, user.Email),
                new JwtClaim("name", user.FullName),
                new JwtClaim("role", user.Role.ToString())
            ],
            expires: expires,
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.Key)), SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(token), expires);
    }
}

/// <summary>Reads identity from the validated token — the only trusted source of "who is calling".</summary>
public static class CurrentUser
{
    public static Guid Id(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(JwtRegisteredClaimNames.Sub)
                   ?? throw new UnauthorizedAccessException("Token has no subject."));

    public static bool IsManager(this ClaimsPrincipal user) => user.IsInRole(nameof(UserRole.Manager));
}

/// <summary>Maps business-rule and concurrency failures to clean HTTP problem responses.</summary>
public class DomainExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        (int status, string title)? mapped = ex switch
        {
            DomainException => (StatusCodes.Status400BadRequest, "Business rule violation"),
            Claims.Infrastructure.InvalidImageException => (StatusCodes.Status400BadRequest, "Invalid photo"),
            DbUpdateConcurrencyException => (StatusCodes.Status409Conflict,
                "This claim was changed by someone else. Refresh and try again."),
            _ => null
        };
        if (mapped is null) return false;

        ctx.Response.StatusCode = mapped.Value.status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = ctx,
            ProblemDetails = new ProblemDetails
            {
                Status = mapped.Value.status,
                Title = mapped.Value.title,
                Detail = ex is DomainException or Claims.Infrastructure.InvalidImageException ? ex.Message : null
            }
        });
    }
}
