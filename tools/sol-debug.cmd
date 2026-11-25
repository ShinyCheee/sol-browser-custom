@echo off
rem Startet Sol Custom mit Diagnose-Log (debug.log im Sol-Datenordner).
set NAVIGATEUR_DEBUG=1
start "" "%LOCALAPPDATA%\SolCustom\app\Sol.exe"
echo Diagnose-Log: %LOCALAPPDATA%\Sol\debug.log
