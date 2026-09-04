@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set SOURCES=
for /r src %%f in (*.java) do set SOURCES=!SOURCES! "%%f"

javac -d out %SOURCES%
if errorlevel 1 (
  echo.
  echo Build failed - see the javac errors above.
  pause
  exit /b 1
)

copy /y "src\main\java\com\cdplayer\icon.png" "out\com\cdplayer\icon.png" >nul

java -cp out com.cdplayer.CDPlayer
if errorlevel 1 (
  echo.
  echo CDPlayer exited with an error - see above.
  pause
)
