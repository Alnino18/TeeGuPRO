@echo off
cd /d "%~dp0\.."
"C:\Program Files\nodejs\node.exe" scripts\send-daily-report.js >> scripts\daily-report.log 2>&1
