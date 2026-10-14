@echo off
REM Helpdesk Lokal — klik 2x: nyalain server (kalo belum jalan) + buka dashboard di browser.
set APPDIR=C:\Users\ridwan\Documents\Default Project\helpdesk-lokal
set PORT=8951
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if errorlevel 1 (
  start "Helpdesk Lokal" /min node "%APPDIR%\server.mjs"
  timeout /t 4 /nobreak >nul
)
start "" "http://127.0.0.1:%PORT%/"
