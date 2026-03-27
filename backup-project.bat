@echo off
echo ========================================
echo    Vidya Mandir Project Backup Tool
echo ========================================
echo.

:: Get current date for folder name
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /format:list') do set datetime=%%I
set date=%datetime:~0,8%
set timestamp=%datetime:~8,6%

:: Create backup folder on desktop
set backup_folder=%USERPROFILE%\Desktop\VidyaMandir-Backup-%date%
echo Creating backup folder: %backup_folder%
mkdir "%backup_folder%" 2>nul

:: Copy all files
echo Copying project files...
xcopy "*.*" "%backup_folder%\" /E /H /C /I /Y >nul 2>&1

:: Copy subdirectories
echo Copying assets and data folders...
if exist "css" xcopy "css\*.*" "%backup_folder%\css\" /E /I /Y >nul 2>&1
if exist "js" xcopy "js\*.*" "%backup_folder%\js\" /E /I /Y >nul 2>&1
if exist "data" xcopy "data\*.*" "%backup_folder%\data\" /E /I /Y >nul 2>&1
if exist "assets" xcopy "assets\*.*" "%backup_folder%\assets\" /E /I /Y >nul 2>&1

echo.
echo ========================================
echo    Backup Complete!
echo ========================================
echo.
echo Backup location: %backup_folder%
echo.
echo You can now:
echo 1. Upload this folder to any hosting service
echo 2. Burn to CD/USB for sharing
echo 3. Copy to another computer
echo.
echo Popular free hosting options:
echo - GitHub Pages (github.com)
echo - Netlify (netlify.com) 
echo - Vercel (vercel.com)
echo - Firebase Hosting (firebase.google.com)
echo.
echo Press any key to open backup folder...
pause >nul
explorer "%backup_folder%"
