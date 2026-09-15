@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py youtube_audio_track_downloader.py %*
) else (
  python youtube_audio_track_downloader.py %*
)
echo.
pause
