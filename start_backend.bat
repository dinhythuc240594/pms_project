@echo off
setlocal
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
    echo Install the backend first using backend\README.md.
    goto :failed
)

".venv\Scripts\python.exe" scripts\local_postgres.py start
if errorlevel 1 goto :failed
".venv\Scripts\python.exe" manage.py db upgrade
if errorlevel 1 goto :failed
".venv\Scripts\python.exe" manage.py db-check
if errorlevel 1 goto :failed
".venv\Scripts\python.exe" app.py
exit /b %errorlevel%

:failed
echo Backend startup failed. See backend\README.md for setup instructions.
pause
exit /b 1
