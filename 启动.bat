@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地服务器： http://localhost:8349
start "" http://localhost:8349
python -m http.server 8349
