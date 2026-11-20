using Claims.Api.Security;
using Claims.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Claims.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(ClaimsDbContext db, TokenService tokens) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        var user = await db.Users.SingleOrDefaultAsync(u => u.Email == email);

        // Same response for unknown email and wrong password — don't reveal which accounts exist.
        if (user is null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new ProblemDetails { Title = "Invalid email or password." });

        var (token, expires) = tokens.Issue(user);
        return new LoginResponse(token, expires, user.ToDto());
    }

    [HttpGet("me")]
    public async Task<ActionResult<UserDto>> Me()
    {
        var id = User.Id();
        var user = await db.Users.FindAsync(id);
        return user is null ? Unauthorized() : user.ToDto();
    }
}
