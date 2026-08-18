using System.Windows.Media;

namespace CDPlayer.Windows.Services;

/// <summary>
/// Thin wrapper around WPF's MediaPlayer, which is backed by Media Foundation on modern
/// Windows — it decodes MP3/AAC/M4A/WAV and (Windows 10 1709+) FLAC using the OS's own
/// codecs, so no bundled FFmpeg binary is needed the way the cross-platform Java build requires.
/// </summary>
public sealed class PlaybackEngine
{
    private readonly MediaPlayer _player = new();
    private bool _pendingPlay;

    public event Action? Ended;
    public event Action? Opened;
    public event Action<string>? Failed;

    public PlaybackEngine()
    {
        _player.MediaEnded += (_, _) => Ended?.Invoke();
        _player.MediaOpened += (_, _) =>
        {
            if (_pendingPlay) _player.Play();
            Opened?.Invoke();
        };
        _player.MediaFailed += (_, e) => Failed?.Invoke(e.ErrorException.Message);
    }

    public bool IsPlaying { get; private set; }

    public void Open(string filePath, bool autoPlay)
    {
        _pendingPlay = autoPlay;
        IsPlaying = autoPlay;
        _player.Open(new Uri(filePath));
        if (!autoPlay) _player.Pause();
    }

    public void Play()
    {
        IsPlaying = true;
        _player.Play();
    }

    public void Pause()
    {
        IsPlaying = false;
        _player.Pause();
    }

    public void Stop()
    {
        IsPlaying = false;
        _player.Stop();
    }

    public TimeSpan Position
    {
        get => _player.Position;
        set => _player.Position = value;
    }

    public TimeSpan? Duration => _player.NaturalDuration.HasTimeSpan ? _player.NaturalDuration.TimeSpan : null;

    public double Volume
    {
        get => _player.Volume;
        set => _player.Volume = Math.Clamp(value, 0, 1);
    }
}
