@echo off
setlocal
cd /d "%~dp0"
java -cp CDPlayer.jar com.cdplayer.CDPlayer
if errorlevel 1 pause
