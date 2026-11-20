using Claims.Infrastructure;
using Claims.Worker;
using Microsoft.EntityFrameworkCore;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddDbContext<ClaimsDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Claims")));
// The worker only writes notifications; it never produces claim events.
builder.Services.AddSingleton<IEventPublisher, NoOpEventPublisher>();
builder.Services.AddHostedService<NotificationConsumer>();

builder.Build().Run();
