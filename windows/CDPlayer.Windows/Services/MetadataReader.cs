using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Media.Imaging;
using CDPlayer.Windows.Models;

namespace CDPlayer.Windows.Services;

/// <summary>
/// Reads title/artist/album tags and embedded cover art directly from the file bytes
/// (ID3v2/ID3v1 for MP3, Vorbis comments for FLAC, ilst atoms for M4A/MP4) — no external
/// decoder or tool required, unlike the FFmpeg/ffprobe dependency the cross-platform build needs.
/// Safe to call from a background thread: file parsing happens on the calling thread, and the
/// resulting property writes are marshaled to the UI thread since AudioTrack is bound in the queue list.
/// </summary>
public static class MetadataReader
{
    public static void Populate(AudioTrack track)
    {
        try
        {
            var ext = Path.GetExtension(track.FilePath).ToLowerInvariant();
            TagResult? result = ext switch
            {
                ".mp3" => ReadId3(track.FilePath),
                ".flac" => ReadFlac(track.FilePath),
                ".m4a" or ".mp4" or ".aac" => ReadMp4(track.FilePath),
                _ => null
            };

            if (result is null) return;

            BitmapImage? art = result.CoverArt is { Length: > 0 } ? DecodeImage(result.CoverArt) : null;

            System.Windows.Application.Current?.Dispatcher.Invoke(() =>
            {
                if (!string.IsNullOrWhiteSpace(result.Title)) track.Title = result.Title;
                if (!string.IsNullOrWhiteSpace(result.Artist)) track.Artist = result.Artist;
                if (!string.IsNullOrWhiteSpace(result.Album)) track.Album = result.Album;
                if (art is not null) track.AlbumArt = art;
            });
        }
        catch
        {
            // Corrupt/unsupported tag data — track still plays, it just falls back to the filename.
        }
    }

    private static BitmapImage? DecodeImage(byte[] bytes)
    {
        try
        {
            var image = new BitmapImage();
            using var ms = new MemoryStream(bytes);
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.StreamSource = ms;
            image.EndInit();
            image.Freeze();
            return image;
        }
        catch
        {
            return null;
        }
    }

    private sealed class TagResult
    {
        public string? Title;
        public string? Artist;
        public string? Album;
        public byte[]? CoverArt;
    }

    // ---------------------------------------------------------------- ID3 (MP3) ----

    private static TagResult? ReadId3(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        var header = new byte[10];
        if (fs.Read(header, 0, 10) != 10 || header[0] != 'I' || header[1] != 'D' || header[2] != '3')
            return ReadId3v1(fs);

        int majorVersion = header[3];
        int tagSize = SyncSafeInt(header, 6);
        var body = new byte[tagSize];
        _ = fs.Read(body, 0, tagSize);

        var result = new TagResult();
        int pos = 0;
        int frameHeaderSize = majorVersion == 2 ? 6 : 10;

        while (pos + frameHeaderSize <= body.Length)
        {
            string frameId;
            int frameSize;

            if (majorVersion == 2)
            {
                frameId = Encoding.ASCII.GetString(body, pos, 3);
                frameSize = (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5];
                pos += 6;
            }
            else
            {
                frameId = Encoding.ASCII.GetString(body, pos, 4);
                frameSize = majorVersion == 4
                    ? SyncSafeInt(body, pos + 4)
                    : (body[pos + 4] << 24) | (body[pos + 5] << 16) | (body[pos + 6] << 8) | body[pos + 7];
                pos += 10;
            }

            if (frameSize <= 0 || pos + frameSize > body.Length || frameId[0] == '\0') break;

            switch (frameId)
            {
                case "TIT2" or "TT2":
                    result.Title = DecodeText(body, pos, frameSize);
                    break;
                case "TPE1" or "TP1":
                    result.Artist = DecodeText(body, pos, frameSize);
                    break;
                case "TALB" or "TAL":
                    result.Album = DecodeText(body, pos, frameSize);
                    break;
                case "APIC" or "PIC":
                    result.CoverArt = DecodePicture(body, pos, frameSize, majorVersion == 2);
                    break;
            }

            pos += frameSize;
        }

        if (result.Title is null && result.Artist is null && result.Album is null)
            return ReadId3v1(fs) ?? result;

        return result;
    }

    private static TagResult? ReadId3v1(FileStream fs)
    {
        if (fs.Length < 128) return null;
        var tag = new byte[128];
        fs.Seek(-128, SeekOrigin.End);
        _ = fs.Read(tag, 0, 128);
        if (tag[0] != 'T' || tag[1] != 'A' || tag[2] != 'G') return null;

        static string Field(byte[] b, int offset, int len) =>
            Encoding.Latin1.GetString(b, offset, len).TrimEnd('\0', ' ');

        return new TagResult
        {
            Title = Field(tag, 3, 30),
            Artist = Field(tag, 33, 30),
            Album = Field(tag, 63, 30)
        };
    }

    private static string DecodeText(byte[] data, int offset, int length)
    {
        if (length <= 0) return "";
        byte encoding = data[offset];
        int start = offset + 1;
        int len = length - 1;

        string raw = encoding switch
        {
            0 => Encoding.Latin1.GetString(data, start, len),
            1 => DecodeUtf16(data, start, len, detectBom: true),
            2 => DecodeUtf16(data, start, len, detectBom: false),
            3 => Encoding.UTF8.GetString(data, start, len),
            _ => Encoding.Latin1.GetString(data, start, len)
        };

        return raw.TrimEnd('\0').Split('\0')[0].Trim();
    }

    private static string DecodeUtf16(byte[] data, int start, int len, bool detectBom)
    {
        if (len <= 0) return "";
        bool bigEndian = false;
        if (detectBom && len >= 2 && data[start] == 0xFE && data[start + 1] == 0xFF)
        {
            bigEndian = true;
            start += 2;
            len -= 2;
        }
        else if (detectBom && len >= 2 && data[start] == 0xFF && data[start + 1] == 0xFE)
        {
            start += 2;
            len -= 2;
        }
        len -= len % 2;
        if (len <= 0) return "";
        return (bigEndian ? Encoding.BigEndianUnicode : Encoding.Unicode).GetString(data, start, len);
    }

    private static byte[]? DecodePicture(byte[] data, int offset, int length, bool isV22)
    {
        int pos = offset;
        int end = offset + length;
        byte textEncoding = data[pos++];

        string mime;
        if (isV22)
        {
            mime = Encoding.ASCII.GetString(data, pos, 3);
            pos += 3;
        }
        else
        {
            int mimeStart = pos;
            while (pos < end && data[pos] != 0) pos++;
            mime = Encoding.ASCII.GetString(data, mimeStart, pos - mimeStart);
            pos++;
        }

        pos++; // picture type byte

        // Description string, terminated per its own encoding — skip past it.
        if (textEncoding is 1 or 2)
        {
            while (pos + 1 < end && !(data[pos] == 0 && data[pos + 1] == 0)) pos += 2;
            pos += 2;
        }
        else
        {
            while (pos < end && data[pos] != 0) pos++;
            pos++;
        }

        if (pos >= end) return null;
        var bytes = new byte[end - pos];
        Array.Copy(data, pos, bytes, 0, bytes.Length);
        return bytes;
    }

    private static int SyncSafeInt(byte[] b, int offset) =>
        (b[offset] << 21) | (b[offset + 1] << 14) | (b[offset + 2] << 7) | b[offset + 3];

    // --------------------------------------------------------------- FLAC ----

    private static TagResult? ReadFlac(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        var magic = new byte[4];
        if (fs.Read(magic, 0, 4) != 4 || Encoding.ASCII.GetString(magic) != "fLaC") return null;

        var result = new TagResult();
        bool last;
        do
        {
            var blockHeader = new byte[4];
            if (fs.Read(blockHeader, 0, 4) != 4) break;

            last = (blockHeader[0] & 0x80) != 0;
            int type = blockHeader[0] & 0x7F;
            int blockSize = (blockHeader[1] << 16) | (blockHeader[2] << 8) | blockHeader[3];

            var block = new byte[blockSize];
            _ = fs.Read(block, 0, blockSize);

            if (type == 4) ParseVorbisComment(block, result);
            else if (type == 6) ParseFlacPicture(block, result);
        } while (!last);

        return result;
    }

    private static void ParseVorbisComment(byte[] block, TagResult result)
    {
        int pos = 0;
        uint vendorLen = ReadUInt32Le(block, pos); pos += 4 + (int)vendorLen;
        if (pos + 4 > block.Length) return;
        uint count = ReadUInt32Le(block, pos); pos += 4;

        for (int i = 0; i < count && pos + 4 <= block.Length; i++)
        {
            uint len = ReadUInt32Le(block, pos); pos += 4;
            if (pos + len > block.Length) break;
            string entry = Encoding.UTF8.GetString(block, pos, (int)len);
            pos += (int)len;

            int eq = entry.IndexOf('=');
            if (eq < 0) continue;
            string key = entry[..eq].ToUpperInvariant();
            string value = entry[(eq + 1)..];

            switch (key)
            {
                case "TITLE": result.Title = value; break;
                case "ARTIST": result.Artist = value; break;
                case "ALBUM": result.Album = value; break;
            }
        }
    }

    private static void ParseFlacPicture(byte[] block, TagResult result)
    {
        int pos = 4; // picture type
        uint mimeLen = ReadUInt32Be(block, pos); pos += 4 + (int)mimeLen;
        uint descLen = ReadUInt32Be(block, pos); pos += 4 + (int)descLen;
        pos += 16; // width, height, depth, colors
        uint dataLen = ReadUInt32Be(block, pos); pos += 4;
        if (pos + dataLen > block.Length) return;

        var bytes = new byte[dataLen];
        Array.Copy(block, pos, bytes, 0, (int)dataLen);
        result.CoverArt = bytes;
    }

    private static uint ReadUInt32Le(byte[] b, int o) =>
        (uint)(b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24));

    private static uint ReadUInt32Be(byte[] b, int o) =>
        (uint)((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);

    // ------------------------------------------------------------ MP4 / M4A ----

    private static TagResult? ReadMp4(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        var result = new TagResult();
        WalkMp4Atoms(fs, fs.Length, result, path: "");
        return result;
    }

    private static void WalkMp4Atoms(FileStream fs, long end, TagResult result, string path)
    {
        while (fs.Position + 8 <= end)
        {
            long atomStart = fs.Position;
            var head = new byte[8];
            if (fs.Read(head, 0, 8) != 8) return;

            long size = ReadUInt32Be(head, 0);
            string type = Encoding.ASCII.GetString(head, 4, 4);
            long headerSize = 8;

            if (size == 1)
            {
                var ext = new byte[8];
                fs.Read(ext, 0, 8);
                size = ((long)ReadUInt32Be(ext, 0) << 32) | ReadUInt32Be(ext, 4);
                headerSize = 16;
            }
            else if (size == 0)
            {
                size = end - atomStart;
            }

            long atomEnd = atomStart + size;
            if (atomEnd > end || size < headerSize) return;

            string childPath = path + "/" + type;

            switch (childPath)
            {
                case "/moov" or "/moov/udta" or "/moov/udta/meta" or "/moov/udta/meta/ilst":
                    // Container atoms we need to descend into. "meta" has a 4-byte version/flags prefix.
                    if (type == "meta") fs.Seek(4, SeekOrigin.Current);
                    WalkMp4Atoms(fs, atomEnd, result, childPath);
                    fs.Seek(atomEnd, SeekOrigin.Begin);
                    continue;

                case "/moov/udta/meta/ilst/©nam":
                case "/moov/udta/meta/ilst/©ART":
                case "/moov/udta/meta/ilst/©alb":
                case "/moov/udta/meta/ilst/covr":
                    ReadIlstEntry(fs, atomEnd, type, result);
                    fs.Seek(atomEnd, SeekOrigin.Begin);
                    continue;
            }

            fs.Seek(atomEnd, SeekOrigin.Begin);
        }
    }

    private static void ReadIlstEntry(FileStream fs, long end, string type, TagResult result)
    {
        // Each tag atom (e.g. ©nam) contains one or more "data" sub-atoms: size(4) type(4)="data" ...
        while (fs.Position + 16 <= end)
        {
            var head = new byte[8];
            if (fs.Read(head, 0, 8) != 8) return;
            long size = ReadUInt32Be(head, 0);
            string subType = Encoding.ASCII.GetString(head, 4, 4);
            long dataEnd = fs.Position - 8 + size;
            if (size < 16 || dataEnd > end) return;

            if (subType == "data")
            {
                var flagsAndReserved = new byte[8];
                fs.Read(flagsAndReserved, 0, 8);
                uint format = ReadUInt32Be(flagsAndReserved, 0);
                int payloadLen = (int)(dataEnd - fs.Position);
                if (payloadLen <= 0) { fs.Seek(dataEnd, SeekOrigin.Begin); continue; }

                var payload = new byte[payloadLen];
                fs.Read(payload, 0, payloadLen);

                if (type == "covr")
                {
                    result.CoverArt = payload;
                }
                else
                {
                    string text = Encoding.UTF8.GetString(payload).TrimEnd('\0');
                    switch (type)
                    {
                        case "©nam": result.Title = text; break;
                        case "©ART": result.Artist = text; break;
                        case "©alb": result.Album = text; break;
                    }
                }
            }

            fs.Seek(dataEnd, SeekOrigin.Begin);
        }
    }
}
