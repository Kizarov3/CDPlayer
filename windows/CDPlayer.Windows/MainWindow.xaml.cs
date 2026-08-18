using System.ComponentModel;
using System.Windows;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using CDPlayer.Windows.Models;
using CDPlayer.Windows.Services;

namespace CDPlayer.Windows;

public partial class MainWindow : Window
{
    private enum RepeatMode { Off, One, All }

    private static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".flac", ".m4a", ".wav", ".aiff", ".aif", ".au", ".wma", ".aac"
    };

    private readonly System.Collections.ObjectModel.ObservableCollection<AudioTrack> Tracks = new();
    private readonly PlaybackEngine _engine = new();
    private readonly System.Windows.Threading.DispatcherTimer _positionTimer;
    private readonly Random _random = new();

    private int _currentIndex = -1;
    private AudioTrack? _displayedTrack;
    private RepeatMode _repeatMode = RepeatMode.Off;
    private bool _shuffle;
    private bool _isSeeking;
    private double? _pendingRestorePositionSeconds;
    private string? _lastFolder;

    public MainWindow()
    {
        InitializeComponent();

        QueueList.ItemsSource = Tracks;
        Tracks.CollectionChanged += (_, _) => UpdateQueuePositionText();

        _engine.Opened += Engine_Opened;
        _engine.Ended += () => AdvanceTrack(userInitiated: false);
        _engine.Failed += Engine_Failed;

        _positionTimer = new System.Windows.Threading.DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(250)
        };
        _positionTimer.Tick += (_, _) => UpdatePositionDisplay();
        _positionTimer.Start();

        Loaded += (_, _) => RestoreState();
        Closing += (_, _) => SaveState();

        ResetNowPlayingUI();
    }

    // ------------------------------------------------------------ Queue building ----

    private void AddFiles_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Filter = "Audio Files|*.mp3;*.flac;*.m4a;*.wav;*.aiff;*.aif;*.au;*.wma;*.aac|All Files|*.*",
            InitialDirectory = _lastFolder ?? Environment.GetFolderPath(Environment.SpecialFolder.MyMusic)
        };

        if (dialog.ShowDialog(this) == true)
        {
            _lastFolder = System.IO.Path.GetDirectoryName(dialog.FileNames[0]);
            AddFiles(dialog.FileNames);
        }
    }

    private void AddFolder_Click(object sender, RoutedEventArgs e)
    {
        using var dialog = new System.Windows.Forms.FolderBrowserDialog
        {
            InitialDirectory = _lastFolder ?? Environment.GetFolderPath(Environment.SpecialFolder.MyMusic)
        };

        if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
        {
            _lastFolder = dialog.SelectedPath;
            AddFiles(EnumerateAudioFiles(dialog.SelectedPath));
        }
    }

    private static IEnumerable<string> EnumerateAudioFiles(string folder) =>
        System.IO.Directory.EnumerateFiles(folder, "*.*", System.IO.SearchOption.AllDirectories)
            .Where(f => SupportedExtensions.Contains(System.IO.Path.GetExtension(f)))
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase);

    private void AddFiles(IEnumerable<string> paths)
    {
        bool wasEmpty = Tracks.Count == 0;

        foreach (var path in paths)
        {
            if (!SupportedExtensions.Contains(System.IO.Path.GetExtension(path))) continue;
            var track = new AudioTrack(path);
            Tracks.Add(track);
            Task.Run(() => MetadataReader.Populate(track));
        }

        if (wasEmpty && Tracks.Count > 0 && _currentIndex < 0)
        {
            _currentIndex = 0;
            LoadCurrentTrack(autoPlay: false);
        }

        UpdateQueuePositionText();
    }

    private void RemoveTrack_Click(object sender, RoutedEventArgs e)
    {
        if (((FrameworkElement)sender).Tag is not AudioTrack track) return;
        int idx = Tracks.IndexOf(track);
        if (idx < 0) return;

        bool wasCurrent = idx == _currentIndex;
        Tracks.RemoveAt(idx);

        if (_currentIndex > idx)
        {
            _currentIndex--;
        }
        else if (wasCurrent)
        {
            if (Tracks.Count == 0)
            {
                _currentIndex = -1;
                _engine.Stop();
                ResetNowPlayingUI();
            }
            else
            {
                _currentIndex = Math.Min(idx, Tracks.Count - 1);
                LoadCurrentTrack(autoPlay: _engine.IsPlaying);
            }
        }

        UpdateQueuePositionText();
    }

    private void ClearQueue_Click(object sender, RoutedEventArgs e)
    {
        Tracks.Clear();
        _currentIndex = -1;
        _engine.Stop();
        ResetNowPlayingUI();
        UpdateQueuePositionText();
    }

    private void QueueList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (QueueList.SelectedItem is not AudioTrack track) return;
        int idx = Tracks.IndexOf(track);
        if (idx < 0) return;
        _currentIndex = idx;
        LoadCurrentTrack(autoPlay: true);
    }

    // ------------------------------------------------------------------- Transport ----

    private void PlayPause_Click(object sender, RoutedEventArgs e)
    {
        if (_currentIndex < 0)
        {
            if (Tracks.Count == 0) return;
            _currentIndex = 0;
            LoadCurrentTrack(autoPlay: true);
            return;
        }

        if (_engine.IsPlaying) _engine.Pause();
        else _engine.Play();

        UpdatePlayPauseIcon();
    }

    private void Previous_Click(object sender, RoutedEventArgs e)
    {
        if (_currentIndex < 0) return;

        if (_engine.Position.TotalSeconds > 3)
        {
            _engine.Position = TimeSpan.Zero;
            return;
        }

        int newIndex = _currentIndex - 1;
        if (newIndex < 0) newIndex = _repeatMode == RepeatMode.All ? Tracks.Count - 1 : 0;
        _currentIndex = newIndex;
        LoadCurrentTrack(autoPlay: true);
    }

    private void Next_Click(object sender, RoutedEventArgs e) => AdvanceTrack(userInitiated: true);

    private void AdvanceTrack(bool userInitiated)
    {
        if (Tracks.Count == 0) return;

        if (_repeatMode == RepeatMode.One && !userInitiated)
        {
            _engine.Position = TimeSpan.Zero;
            _engine.Play();
            return;
        }

        int nextIndex;
        if (_shuffle && Tracks.Count > 1)
        {
            do { nextIndex = _random.Next(Tracks.Count); } while (nextIndex == _currentIndex);
        }
        else
        {
            nextIndex = _currentIndex + 1;
            if (nextIndex >= Tracks.Count)
            {
                if (_repeatMode == RepeatMode.All)
                {
                    nextIndex = 0;
                }
                else
                {
                    _engine.Stop();
                    UpdatePlayPauseIcon();
                    return;
                }
            }
        }

        _currentIndex = nextIndex;
        LoadCurrentTrack(autoPlay: true);
    }

    private void LoadCurrentTrack(bool autoPlay)
    {
        if (_currentIndex < 0 || _currentIndex >= Tracks.Count) return;
        var track = Tracks[_currentIndex];

        StatusText.Text = "";
        _engine.Open(track.FilePath, autoPlay);

        if (_displayedTrack is not null) _displayedTrack.PropertyChanged -= CurrentTrack_PropertyChanged;
        _displayedTrack = track;
        track.PropertyChanged += CurrentTrack_PropertyChanged;

        UpdateNowPlayingHeader(track);
        QueueList.SelectedIndex = _currentIndex;
        if (QueueList.SelectedItem is not null) QueueList.ScrollIntoView(QueueList.SelectedItem);

        UpdatePlayPauseIcon();
        UpdateQueuePositionText();
    }

    private void CurrentTrack_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is AudioTrack track && track == _displayedTrack) UpdateNowPlayingHeader(track);
    }

    private void Engine_Opened()
    {
        if (_displayedTrack is not null && _engine.Duration is { } duration)
        {
            _displayedTrack.Duration = duration;
            SeekSlider.Maximum = Math.Max(duration.TotalSeconds, 0.1);
            DurationText.Text = FormatTime(duration);
        }

        if (_pendingRestorePositionSeconds is { } seconds)
        {
            _engine.Position = TimeSpan.FromSeconds(seconds);
            _pendingRestorePositionSeconds = null;
        }

        UpdatePlayPauseIcon();
    }

    private void Engine_Failed(string message)
    {
        StatusText.Text = $"Couldn't play this track: {message}";
        AdvanceTrack(userInitiated: false);
    }

    // ------------------------------------------------------------------------ Seek ----

    private void UpdatePositionDisplay()
    {
        if (_isSeeking || _currentIndex < 0) return;
        var pos = _engine.Position;
        SeekSlider.Value = pos.TotalSeconds;
        PositionText.Text = FormatTime(pos);
    }

    private void SeekSlider_DragStarted(object sender, DragStartedEventArgs e) => _isSeeking = true;

    private void SeekSlider_DragCompleted(object sender, DragCompletedEventArgs e)
    {
        _isSeeking = false;
        if (_currentIndex >= 0) _engine.Position = TimeSpan.FromSeconds(SeekSlider.Value);
    }

    private void VolumeSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e) =>
        _engine.Volume = e.NewValue;

    // --------------------------------------------------------------- Shuffle/repeat ----

    private void ShuffleToggle_Click(object sender, RoutedEventArgs e) => _shuffle = ShuffleToggle.IsChecked == true;

    private void RepeatToggle_Click(object sender, RoutedEventArgs e)
    {
        _repeatMode = _repeatMode switch
        {
            RepeatMode.Off => RepeatMode.One,
            RepeatMode.One => RepeatMode.All,
            _ => RepeatMode.Off
        };
        UpdateRepeatVisual();
    }

    private void UpdateRepeatVisual()
    {
        RepeatToggle.IsChecked = _repeatMode != RepeatMode.Off;
        RepeatToggle.Content = _repeatMode == RepeatMode.One ? "" : "";
        RepeatToggle.ToolTip = _repeatMode switch
        {
            RepeatMode.One => "Repeat: one track",
            RepeatMode.All => "Repeat: whole queue",
            _ => "Repeat: off"
        };
    }

    // ----------------------------------------------------------------------- Input ----

    private void Window_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        switch (e.Key)
        {
            case Key.Space or Key.K:
                PlayPause_Click(this, new RoutedEventArgs());
                e.Handled = true;
                break;
            case Key.J:
                Previous_Click(this, new RoutedEventArgs());
                e.Handled = true;
                break;
            case Key.L:
                Next_Click(this, new RoutedEventArgs());
                e.Handled = true;
                break;
            case Key.Left when _currentIndex >= 0:
                _engine.Position = TimeSpan.FromSeconds(Math.Max(0, _engine.Position.TotalSeconds - 15));
                e.Handled = true;
                break;
            case Key.Right when _currentIndex >= 0:
                _engine.Position = TimeSpan.FromSeconds(_engine.Position.TotalSeconds + 15);
                e.Handled = true;
                break;
        }
    }

    private void Window_DragOver(object sender, System.Windows.DragEventArgs e)
    {
        e.Effects = e.Data.GetDataPresent(System.Windows.DataFormats.FileDrop)
            ? System.Windows.DragDropEffects.Copy
            : System.Windows.DragDropEffects.None;
        e.Handled = true;
    }

    private void Window_Drop(object sender, System.Windows.DragEventArgs e)
    {
        if (!e.Data.GetDataPresent(System.Windows.DataFormats.FileDrop)) return;
        var paths = (string[])e.Data.GetData(System.Windows.DataFormats.FileDrop);

        var files = new List<string>();
        foreach (var path in paths)
        {
            if (System.IO.Directory.Exists(path)) files.AddRange(EnumerateAudioFiles(path));
            else if (System.IO.File.Exists(path)) files.Add(path);
        }

        AddFiles(files);
    }

    // ----------------------------------------------------------------------- Visuals ----

    private void UpdatePlayPauseIcon() => PlayPauseButton.Content = _engine.IsPlaying ? "" : "";

    private void UpdateQueuePositionText()
    {
        QueuePositionText.Text = $"QUEUE {(_currentIndex >= 0 ? _currentIndex + 1 : 0)} / {Tracks.Count}";
        ClearQueueButton.IsEnabled = Tracks.Count > 0;
    }

    private void UpdateNowPlayingHeader(AudioTrack track)
    {
        TitleText.Text = track.DisplayTitle;
        var subtitle = string.Join("  —  ", new[] { track.Artist, track.Album }.Where(s => !string.IsNullOrWhiteSpace(s)));
        ArtistAlbumText.Text = string.IsNullOrWhiteSpace(subtitle) ? "Unknown artist" : subtitle;
        AlbumArtImage.Source = track.AlbumArt;
    }

    private void ResetNowPlayingUI()
    {
        TitleText.Text = "No track loaded";
        ArtistAlbumText.Text = "Add files or drop them here to build a queue";
        AlbumArtImage.Source = null;
        SeekSlider.Value = 0;
        PositionText.Text = "0:00";
        DurationText.Text = "0:00";
        UpdatePlayPauseIcon();
    }

    private static string FormatTime(TimeSpan t) => $"{(int)t.TotalMinutes}:{t.Seconds:D2}";

    // --------------------------------------------------------------------- Persistence ----

    private void RestoreState()
    {
        var state = QueueStore.Load();
        _lastFolder = state.LastFolder;

        VolumeSlider.Value = Math.Clamp(state.Volume, 0, 1);
        _engine.Volume = VolumeSlider.Value;

        _shuffle = state.Shuffle;
        ShuffleToggle.IsChecked = state.Shuffle;

        _repeatMode = (RepeatMode)Math.Clamp(state.RepeatMode, 0, 2);
        UpdateRepeatVisual();

        foreach (var path in state.FilePaths)
        {
            if (!System.IO.File.Exists(path)) continue;
            var track = new AudioTrack(path);
            Tracks.Add(track);
            Task.Run(() => MetadataReader.Populate(track));
        }

        if (state.CurrentIndex >= 0 && state.CurrentIndex < Tracks.Count)
        {
            _currentIndex = state.CurrentIndex;
            _pendingRestorePositionSeconds = state.PositionSeconds;
            LoadCurrentTrack(autoPlay: false);
        }

        UpdateQueuePositionText();
    }

    private void SaveState()
    {
        var state = new SavedState
        {
            FilePaths = Tracks.Select(t => t.FilePath).ToList(),
            CurrentIndex = _currentIndex,
            PositionSeconds = _currentIndex >= 0 ? _engine.Position.TotalSeconds : 0,
            Volume = _engine.Volume,
            Shuffle = _shuffle,
            RepeatMode = (int)_repeatMode,
            LastFolder = _lastFolder
        };
        QueueStore.Save(state);
    }
}
