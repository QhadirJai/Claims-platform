using System.Buffers.Binary;
using System.Text;

namespace Claims.Infrastructure;

public class InvalidImageException(string message) : Exception(message);

public record SanitizedImage(byte[] Bytes, string ContentType, string Extension);

/// <summary>
/// Validates uploaded photos by their actual bytes (never the file name or the Content-Type header the
/// client sent) and strips metadata that can carry personal data — most importantly EXIF GPS coordinates.
///
/// JPEG: drops APP1 (EXIF / XMP), APP13 (IPTC) and comment segments; keeps JFIF, ICC colour profile, image data.
/// PNG:  drops eXIf and text/time chunks; keeps everything needed to render.
///
/// The web client already re-encodes photos (which also bakes in orientation), so this is defence in depth
/// for uploads that bypass the UI.
/// </summary>
public static class ImageSanitizer
{
    public const long MaxBytes = 10 * 1024 * 1024;

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    public static SanitizedImage Sanitize(byte[] data)
    {
        if (data.Length == 0) throw new InvalidImageException("The file is empty.");
        if (data.Length > MaxBytes) throw new InvalidImageException("Each photo must be 10 MB or smaller.");

        if (data.Length > 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
            return new SanitizedImage(StripJpeg(data), "image/jpeg", ".jpg");
        if (data.AsSpan().StartsWith(PngSignature))
            return new SanitizedImage(StripPng(data), "image/png", ".png");

        throw new InvalidImageException("Only JPEG and PNG photos are accepted.");
    }

    private static byte[] StripJpeg(byte[] d)
    {
        using var output = new MemoryStream(d.Length);
        output.Write(d, 0, 2); // SOI
        var pos = 2;

        while (pos < d.Length)
        {
            if (d[pos] != 0xFF) throw new InvalidImageException("The JPEG file is corrupt.");
            while (pos + 1 < d.Length && d[pos + 1] == 0xFF) pos++; // fill bytes
            if (pos + 1 >= d.Length) throw new InvalidImageException("The JPEG file is truncated.");

            var marker = d[pos + 1];

            // Start of scan / end of image: everything after is compressed image data — copy as-is.
            if (marker is 0xDA or 0xD9)
            {
                output.Write(d, pos, d.Length - pos);
                return output.ToArray();
            }
            // Standalone markers carry no length.
            if (marker is 0x01 or (>= 0xD0 and <= 0xD7))
            {
                output.Write(d, pos, 2);
                pos += 2;
                continue;
            }

            if (pos + 4 > d.Length) throw new InvalidImageException("The JPEG file is truncated.");
            var length = BinaryPrimitives.ReadUInt16BigEndian(d.AsSpan(pos + 2, 2));
            if (length < 2 || pos + 2 + length > d.Length) throw new InvalidImageException("The JPEG file is corrupt.");

            var drop = marker is 0xE1 or 0xED or 0xFE; // APP1 EXIF/XMP, APP13 IPTC, COM
            if (!drop) output.Write(d, pos, 2 + length);
            pos += 2 + length;
        }
        throw new InvalidImageException("The JPEG file has no image data.");
    }

    private static readonly HashSet<string> DroppedPngChunks = ["eXIf", "tEXt", "zTXt", "iTXt", "tIME"];

    private static byte[] StripPng(byte[] d)
    {
        using var output = new MemoryStream(d.Length);
        output.Write(PngSignature);
        var pos = PngSignature.Length;

        while (pos + 12 <= d.Length)
        {
            var length = BinaryPrimitives.ReadUInt32BigEndian(d.AsSpan(pos, 4));
            if (length > int.MaxValue || pos + 12 + (long)length > d.Length) throw new InvalidImageException("The PNG file is corrupt.");
            var type = Encoding.ASCII.GetString(d, pos + 4, 4);
            var total = 12 + (int)length; // length + type + data + CRC

            if (!DroppedPngChunks.Contains(type)) output.Write(d, pos, total);
            pos += total;
            if (type == "IEND") return output.ToArray();
        }
        throw new InvalidImageException("The PNG file is truncated.");
    }

    /// <summary>Display name only (never used as a storage path). Strips directories and odd characters.</summary>
    public static string SafeFileName(string? original, string extension)
    {
        var name = Path.GetFileNameWithoutExtension(original ?? "");
        var cleaned = new string(name.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_' or ' ').ToArray()).Trim();
        if (cleaned.Length == 0) cleaned = "photo";
        if (cleaned.Length > 80) cleaned = cleaned[..80];
        return cleaned + extension;
    }
}
