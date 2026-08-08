@echo off
setlocal
set APP_NAME=CDPlayer
set OUT_DIR=dist\windows
if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"
mkdir "%OUT_DIR%"

javac -d "%OUT_DIR%\classes" src\main\java\com\cdplayer\CDPlayer.java
jar --create --file "%OUT_DIR%\%APP_NAME%.jar" --main-class com.cdplayer.CDPlayer -C "%OUT_DIR%\classes" .

(
  echo @echo off
  echo setlocal
  echo java -cp "%~dp0%APP_NAME%.jar" com.cdplayer.CDPlayer
  echo if errorlevel 1 pause
) > "%OUT_DIR%\run.bat"

copy "%OUT_DIR%\%APP_NAME%.jar" "%OUT_DIR%\"

echo Build complete. Launch %OUT_DIR%\run.bat
