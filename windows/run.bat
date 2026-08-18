@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set SOURCES=
for /r src %%f in (*.java) do set SOURCES=!SOURCES! "%%f"

javac -d out %SOURCES%
if errorlevel 1 exit /b 1

copy /y "src\main\java\com\cdplayer\icon.png" "out\com\cdplayer\icon.png" >nul

java -cp out com.cdplayer.CDPlayer
