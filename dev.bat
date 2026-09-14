@echo off
REM Keepers dev launcher - run from project root

start "Server" cmd /k "cd /d %~dp0server && py -3.14 -m uvicorn main:app --reload --host 0.0.0.0"

start "Frontend" cmd /k "cd /d %~dp0Keepers && npx expo start"

REM start "ngrok" cmd /k "ngrok http 8000"