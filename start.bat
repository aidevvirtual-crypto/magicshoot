@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Menginstal dependensi...
  call npm install
)
start "" http://localhost:3000/
node --no-warnings=ExperimentalWarning server.js
pause
