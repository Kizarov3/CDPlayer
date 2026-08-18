using System.IO;
using System.Text.Json;

namespace CDPlayer.Windows.Services;

public sealed class SavedState
{
    public List<string> FilePaths { get; set; } = new();
    public int CurrentIndex { get; set; } = -1;
    public double PositionSeconds { get; set; }
    public double Volume { get; set; } = 1.0;
    public bool Shuffle { get; set; }
    public int RepeatMode { get; set; }
    public string? LastFolder { get; set; }
}

public static class QueueStore
{
    private static readonly string StateDir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CDPlayer");

    private static readonly string StateFile = Path.Combine(StateDir, "state.json");

    public static SavedState Load()
    {
        try
        {
            if (File.Exists(StateFile))
            {
                var json = File.ReadAllText(StateFile);
                var state = JsonSerializer.Deserialize<SavedState>(json);
                if (state is not null) return state;
            }
        }
        catch
        {
            // Corrupt or unreadable state file — start fresh instead of crashing on launch.
        }
        return new SavedState();
    }

    public static void Save(SavedState state)
    {
        try
        {
            Directory.CreateDirectory(StateDir);
            var json = JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(StateFile, json);
        }
        catch
        {
            // Best-effort persistence — losing the saved queue on a write failure isn't fatal.
        }
    }
}
