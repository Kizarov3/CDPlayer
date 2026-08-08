# CDPlayer

A tactile, CD-inspired **Java desktop app**. Load a local track, press play, and the CD spins like a real one. It does not use a browser or HTML.

## 🚀 Quick Start

CDPlayer runs on **Windows, macOS, and Linux**. All you need is Java—no frameworks or complex installations.

```bash
./run.sh  # macOS & Linux
# or
run.bat   # Windows
```

The CDPlayer desktop window opens directly.

## 📋 Installation Guide by Platform

### Prerequisites (All Platforms)

- **Java Development Kit (JDK) 8 or newer**
  - [Download JDK](https://www.oracle.com/java/technologies/javase-downloads.html) or use your platform's package manager
  - Verify installation: `java -version`

- **FFmpeg** (optional, for FLAC/M4A support)
  - WAV, AIFF, and AU work natively without FFmpeg
  - Install FFmpeg if you want FLAC/M4A playback

### Windows

1. **Install Java:**
   - Download [Java JDK 8+](https://www.oracle.com/java/technologies/javase-downloads.html)
   - Run the installer and follow the setup wizard
   - Verify: Open Command Prompt and type `java -version`

2. **Install FFmpeg (optional):**
   - Download from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Or use a package manager: `choco install ffmpeg` (requires Chocolatey)
   - Add to PATH if not done automatically

3. **Run CDPlayer:**
   ```cmd
   run.bat
   ```
   Or manually compile and run:
   ```cmd
   javac -d out %JAVA_FILES%
   java -cp out com.cdplayer.CDPlayer
   ```

### macOS

1. **Install Java:**
   ```bash
   # Using Homebrew (recommended)
   brew install openjdk@11
   
   # Or download from oracle.com
   ```

2. **Install FFmpeg (optional):**
   ```bash
   brew install ffmpeg
   ```

3. **Run CDPlayer:**
   ```bash
   chmod +x ./run.sh
   ./run.sh
   ```

### Linux (Ubuntu/Debian)

1. **Install Java:**
   ```bash
   sudo apt update
   sudo apt install default-jdk
   ```

2. **Install FFmpeg (optional):**
   ```bash
   sudo apt install ffmpeg
   ```

3. **Run CDPlayer:**
   ```bash
   chmod +x ./run.sh
   ./run.sh
   ```

### Linux (Fedora/RHEL)

1. **Install Java:**
   ```bash
   sudo dnf install java-11-openjdk
   ```

2. **Install FFmpeg (optional):**
   ```bash
   sudo dnf install ffmpeg
   ```

3. **Run CDPlayer:**
   ```bash
   chmod +x ./run.sh
   ./run.sh
   ```

## 🎵 How to Use

- **Load a track:** Click "Load a track" button or drag an audio file onto the player
- **Create a queue:** Drop multiple songs or an entire folder
- **Shuffle & Repeat:** Use the controls to customize playback
- **View metadata:** See artist, title, album, and track time from your files
- **Album artwork:** CDPlayer shows embedded album art from your files

**Supported formats:**
- ✅ Native: WAV, AIFF, AU
- ✅ With FFmpeg: FLAC, M4A

> **Privacy Note:** All audio stays on your device and is never uploaded.

## ⚙️ Features

- Local audio playback (WAV, AIFF, AU). FLAC/M4A supported via `ffmpeg` conversion
- Drag & drop files or folders to add items to the queue
- Folder scanning to add entire albums or directories
- Queue management with Shuffle and Repeat modes
- Embedded metadata display (artist, title, album, track time)
- Album artwork priority: uses embedded art when available, falls back to iTunes lookup
- Simple, CD-like desktop UI with compact and expanded views

## 🔧 Advanced: Manual Compilation

If you prefer to compile manually:

```bash
# Compile all Java files
javac -d out $(find src -name '*.java')

# Run the application
java -cp out com.cdplayer.CDPlayer
```

## ❓ Troubleshooting

| Issue | Solution |
|-------|----------|
| **"java: command not found"** | Install Java JDK (see platform-specific instructions above) |
| **Permission denied running `./run.sh`** | Run `chmod +x ./run.sh` on macOS/Linux |
| **No sound output** | Check system audio settings and verify Java audio access |
| **FLAC/M4A won't play** | Install FFmpeg and add it to your PATH |
| **Missing album artwork** | Ensure files have embedded tags, or enable internet for iTunes lookup |
| **Window won't open** | Try running manually: `java -cp out com.cdplayer.CDPlayer` |

## 📝 License

See LICENSE file for details.

## 🎯 Technologies

- **Language:** Java
- **Audio Processing:** FFmpeg (for FLAC/M4A conversion)
- **UI:** Native Java Swing/AWT
