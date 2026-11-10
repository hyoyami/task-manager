@echo off
cd /d "%~dp0"
echo TASK MANAGER em http://localhost:8000  (feche esta janela para encerrar)
start "" http://localhost:8000
python -m http.server 8000
