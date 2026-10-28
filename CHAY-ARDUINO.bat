@echo off
setlocal
cd /d "%~dp0"
echo.
echo =============================================
echo       ARDUINO 3D VIET NAM
echo =============================================
echo Mo trinh duyet tai http://127.0.0.1:8091/
echo Giu cua so nay mo khi su dung ung dung.
echo Nhan Ctrl+C de dung.
echo.
python scripts\serve.py --port 8091 --open
if errorlevel 1 (
  echo.
  echo Khong the khoi dong bang python. Dang thu py -3...
  py -3 scripts\serve.py --port 8091 --open
)
pause
