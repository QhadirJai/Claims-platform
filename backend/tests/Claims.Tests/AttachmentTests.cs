using System.Buffers.Binary;
using System.Text;
using Claims.Domain;
using Claims.Infrastructure;
using Claims.Worker;

namespace Claims.Tests;

public class AttachmentRuleTests
{
    private static readonly DateTime Now = new(2026, 11, 20, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Claimant = Guid.NewGuid();
    private static readonly Guid Officer = Guid.NewGuid();

    private static Claim NewClaim() => Claim.Submit(Claimant, ClaimType.Motor, Market.SG, "POL-1",
        new DateOnly(2026, 11, 18), "Orchard Rd", "Rear bumper damaged in a car park.", 1500m, Now);

    private static NewAttachment Photo() =>
        new(Guid.NewGuid(), "photo.jpg", "image/jpeg", 1000, $"claims/x/{Guid.NewGuid()}");

    private static List<NewAttachment> Photos(int n) => Enumerable.Range(0, n).Select(_ => Photo()).ToList();

    [Fact]
    public void Claimant_can_attach_photos_and_one_timeline_event_is_recorded_per_batch()
    {
        var claim = NewClaim();
        claim.AddAttachments(Photos(3), Claimant, Now);

        Assert.Equal(3, claim.Attachments.Count);
        var ev = claim.Events.Last();
        Assert.Equal(ClaimEventTypes.EvidenceAdded, ev.EventType);
        Assert.Equal("3 photos added", ev.Note);
        Assert.Equal(ClaimStatus.Submitted, claim.Status); // evidence does not move the lifecycle
    }

    [Fact]
    public void Another_user_cannot_attach_photos() =>
        Assert.Throws<DomainException>(() => NewClaim().AddAttachments(Photos(1), Guid.NewGuid(), Now));

    [Fact]
    public void Photos_can_answer_an_information_request()
    {
        var claim = NewClaim();
        claim.AssignTo(Officer, Officer, Now);
        claim.RequestInformation("Please send photos of the damage.", Officer, false, Now);

        claim.AddAttachments(Photos(2), Claimant, Now);
        Assert.Equal(2, claim.Attachments.Count);
    }

    [Fact]
    public void Photos_cannot_be_added_after_a_decision()
    {
        var claim = NewClaim();
        claim.AssignTo(Officer, Officer, Now);
        claim.Approve(1000m, Officer, false, Now);

        Assert.Throws<DomainException>(() => claim.AddAttachments(Photos(1), Claimant, Now));
    }

    [Fact]
    public void A_claim_holds_at_most_ten_photos()
    {
        var claim = NewClaim();
        claim.AddAttachments(Photos(8), Claimant, Now);
        Assert.Throws<DomainException>(() => claim.AddAttachments(Photos(3), Claimant, Now));
        Assert.Equal(8, claim.Attachments.Count);
    }

    [Fact]
    public void New_evidence_notifies_the_assigned_officer_only()
    {
        var m = new ClaimEventMessage(Guid.NewGuid(), ClaimEventTypes.EvidenceAdded, Guid.NewGuid(), "CLM-1",
            Claimant, Officer, ClaimStatus.UnderReview, Claimant, "2 photos added", Now);
        var n = Assert.Single(NotificationConsumer.BuildNotifications(m));
        Assert.Equal(Officer, n.UserId);
    }
}

public class ImageSanitizerTests
{
    private static byte[] Segment(byte marker, byte[] payload)
    {
        var seg = new byte[4 + payload.Length];
        seg[0] = 0xFF; seg[1] = marker;
        BinaryPrimitives.WriteUInt16BigEndian(seg.AsSpan(2), (ushort)(payload.Length + 2));
        payload.CopyTo(seg, 4);
        return seg;
    }

    /// <summary>Minimal JPEG layout: SOI, APP0 (JFIF), APP1 (EXIF with "GPS"), COM, SOS + data, EOI.</summary>
    private static byte[] JpegWithExif()
    {
        var parts = new List<byte[]>
        {
            new byte[] { 0xFF, 0xD8 },
            Segment(0xE0, Encoding.ASCII.GetBytes("JFIF\0\x01\x01")),
            Segment(0xE1, Encoding.ASCII.GetBytes("Exif\0\0GPS 1.3521N 103.8198E")),
            Segment(0xFE, Encoding.ASCII.GetBytes("taken by someone")),
            Segment(0xDA, new byte[] { 1, 2, 3 }),
            new byte[] { 0x11, 0x22, 0x33, 0xFF, 0xD9 }
        };
        return parts.SelectMany(p => p).ToArray();
    }

    [Fact]
    public void Jpeg_metadata_is_stripped_but_image_data_kept()
    {
        var input = JpegWithExif();
        var result = ImageSanitizer.Sanitize(input);
        var text = Encoding.ASCII.GetString(result.Bytes);

        Assert.Equal("image/jpeg", result.ContentType);
        Assert.DoesNotContain("GPS", text);
        Assert.DoesNotContain("taken by", text);
        Assert.Contains("JFIF", text);
        Assert.Equal(new byte[] { 0x11, 0x22, 0x33, 0xFF, 0xD9 }, result.Bytes[^5..]);
    }

    private static byte[] Chunk(string type, byte[] data)
    {
        var c = new byte[12 + data.Length];
        BinaryPrimitives.WriteUInt32BigEndian(c, (uint)data.Length);
        Encoding.ASCII.GetBytes(type).CopyTo(c, 4);
        data.CopyTo(c, 8);
        return c; // CRC left as zero: the sanitizer copies chunks verbatim and does not re-encode
    }

    [Fact]
    public void Png_text_and_exif_chunks_are_stripped()
    {
        byte[] sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        var input = new[]
        {
            sig, Chunk("IHDR", new byte[13]), Chunk("tEXt", Encoding.ASCII.GetBytes("Author\0someone")),
            Chunk("eXIf", Encoding.ASCII.GetBytes("GPS")), Chunk("IDAT", new byte[] { 9, 9 }), Chunk("IEND", [])
        }.SelectMany(p => p).ToArray();

        var result = ImageSanitizer.Sanitize(input);
        var text = Encoding.ASCII.GetString(result.Bytes);

        Assert.Equal("image/png", result.ContentType);
        Assert.Contains("IHDR", text);
        Assert.Contains("IDAT", text);
        Assert.DoesNotContain("tEXt", text);
        Assert.DoesNotContain("eXIf", text);
    }

    [Theory]
    [InlineData("<html><script>alert(1)</script></html>")]
    [InlineData("GIF89a....")]
    [InlineData("%PDF-1.7")]
    public void Non_image_content_is_rejected_regardless_of_file_name(string content) =>
        Assert.Throws<InvalidImageException>(() => ImageSanitizer.Sanitize(Encoding.ASCII.GetBytes(content)));

    [Fact]
    public void Truncated_jpeg_is_rejected() =>
        Assert.Throws<InvalidImageException>(() => ImageSanitizer.Sanitize([0xFF, 0xD8, 0xFF, 0xE1, 0x40, 0x00]));

    [Theory]
    [InlineData("../../etc/passwd.jpg", "passwd.jpg")]
    [InlineData("C:\\temp\\car door.JPG", "car door.jpg")]
    [InlineData("<script>.png", "script.jpg")]
    [InlineData("", "photo.jpg")]
    public void File_names_are_reduced_to_a_safe_display_name(string input, string expected) =>
        Assert.Equal(expected, ImageSanitizer.SafeFileName(input, ".jpg"));
}
