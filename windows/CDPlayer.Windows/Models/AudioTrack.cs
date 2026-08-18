using System.ComponentModel;
using System.IO;
using System.Runtime.CompilerServices;
using System.Windows.Media.Imaging;

namespace CDPlayer.Windows.Models;

public sealed class AudioTrack : INotifyPropertyChanged
{
    public string FilePath { get; }

    public string DisplayTitle => string.IsNullOrWhiteSpace(Title)
        ? Path.GetFileNameWithoutExtension(FilePath)
        : Title;

    private string? _title;
    public string? Title
    {
        get => _title;
        set { _title = value; OnChanged(); OnChanged(nameof(DisplayTitle)); }
    }

    private string? _artist;
    public string? Artist
    {
        get => _artist;
        set { _artist = value; OnChanged(); }
    }

    private string? _album;
    public string? Album
    {
        get => _album;
        set { _album = value; OnChanged(); }
    }

    private TimeSpan? _duration;
    public TimeSpan? Duration
    {
        get => _duration;
        set { _duration = value; OnChanged(); OnChanged(nameof(DurationText)); }
    }

    public string DurationText => Duration is { } d ? $"{(int)d.TotalMinutes}:{d.Seconds:D2}" : "--:--";

    private BitmapImage? _albumArt;
    public BitmapImage? AlbumArt
    {
        get => _albumArt;
        set { _albumArt = value; OnChanged(); }
    }

    public AudioTrack(string filePath)
    {
        FilePath = filePath;
        Title = Path.GetFileNameWithoutExtension(filePath);
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
