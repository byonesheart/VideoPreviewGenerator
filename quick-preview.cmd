@echo off
setlocal
cd /d "%~dp0"
start "" /b "%~dp0node_modules\electron\dist\electron.exe" "%~dp0" --quick %*
endlocal
