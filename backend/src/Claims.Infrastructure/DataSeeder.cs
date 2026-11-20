using Claims.Domain;
using Microsoft.EntityFrameworkCore;

namespace Claims.Infrastructure;

/// <summary>Fabricated demo data for local runs. No real people, policies or company data.</summary>
public static class DataSeeder
{
    public const string DemoPassword = "Passw0rd!";

    public static async Task SeedAsync(ClaimsDbContext db)
    {
        if (await db.Users.AnyAsync()) return;

        User NewUser(string email, string name, UserRole role) => new()
        {
            Email = email,
            FullName = name,
            Role = role,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(DemoPassword)
        };

        var alice = NewUser("alice@demo.local", "Alice Tan", UserRole.Claimant);
        var ben = NewUser("ben@demo.local", "Ben Wong", UserRole.Claimant);
        var olivia = NewUser("olivia@demo.local", "Olivia Lim", UserRole.ClaimsOfficer);
        var oscar = NewUser("oscar@demo.local", "Oscar Lee", UserRole.ClaimsOfficer);
        var maya = NewUser("maya@demo.local", "Maya Chen", UserRole.Manager);
        db.Users.AddRange(alice, ben, olivia, oscar, maya);

        var now = DateTime.UtcNow;
        DateTime Ago(int days) => now.AddDays(-days);
        DateOnly D(int days) => DateOnly.FromDateTime(now.AddDays(-days));

        // Unassigned, waiting in the queue
        var c1 = Claim.Submit(alice.Id, ClaimType.Motor, Market.SG, "POL-SG-10021", D(2), "Orchard Road, Singapore",
            "Rear-ended while stopped at a traffic light. Bumper and boot damaged.", 4_800m, Ago(1));
        var c2 = Claim.Submit(ben.Id, ClaimType.Property, Market.MY, "POL-MY-20877", D(6), "Petaling Jaya, Selangor",
            "Burst pipe flooded the kitchen; cabinets and flooring damaged.", 12_500m, Ago(5));
        var c3 = Claim.Submit(ben.Id, ClaimType.Motor, Market.HK, "POL-HK-30410", D(3), "Nathan Road, Kowloon",
            "Side mirror and door scraped in a car park.", 1_900m, Ago(2));

        // Under review with Olivia, reserve set
        var c4 = Claim.Submit(alice.Id, ClaimType.Property, Market.SG, "POL-SG-10388", D(12), "Tampines, Singapore",
            "Electrical fire in the living room. Smoke damage throughout.", 38_000m, Ago(10));
        c4.AssignTo(olivia.Id, olivia.Id, Ago(9));
        c4.SetReserve(30_000m, olivia.Id, false, Ago(8));

        // Waiting on claimant information (Oscar)
        var c5 = Claim.Submit(alice.Id, ClaimType.Motor, Market.AU, "POL-AU-55120", D(15), "Parramatta, NSW",
            "Hail damage to roof and windscreen.", 7_200m, Ago(14));
        c5.AssignTo(oscar.Id, oscar.Id, Ago(13));
        c5.RequestInformation("Please provide photos of the damage and the repair quote.", oscar.Id, false, Ago(12));

        // Approved, awaiting settlement (Olivia)
        var c6 = Claim.Submit(ben.Id, ClaimType.Property, Market.TH, "POL-TH-70011", D(30), "Sukhumvit, Bangkok",
            "Storm broke two windows and damaged furniture.", 6_400m, Ago(28));
        c6.AssignTo(olivia.Id, olivia.Id, Ago(27));
        c6.SetReserve(6_000m, olivia.Id, false, Ago(26));
        c6.Approve(5_750m, olivia.Id, false, Ago(20));

        // Closed claims for performance metrics
        var c7 = Claim.Submit(alice.Id, ClaimType.Motor, Market.ID, "POL-ID-80442", D(40), "Kemang, Jakarta",
            "Minor collision, front bumper replacement.", 2_300m, Ago(38));
        c7.AssignTo(oscar.Id, oscar.Id, Ago(37));
        c7.Approve(2_300m, oscar.Id, false, Ago(33));
        c7.Settle(oscar.Id, false, Ago(30));

        var c8 = Claim.Submit(ben.Id, ClaimType.Property, Market.HK, "POL-HK-30999", D(25), "Sha Tin, New Territories",
            "Water damage from neighbour's unit.", 9_100m, Ago(24));
        c8.AssignTo(olivia.Id, olivia.Id, Ago(23));
        c8.Reject("Damage originated from a third-party unit; claim should be directed to the neighbour's insurer.", olivia.Id, false, Ago(18));

        db.Claims.AddRange(c1, c2, c3, c4, c5, c6, c7, c8);
        await db.SaveChangesAsync();
    }
}
