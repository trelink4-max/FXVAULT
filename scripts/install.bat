@echo off
REM FXVault installer (Windows)
REM Copies this extension into Adobe's CEP extensions folder and enables
REM debug mode (required to load an unsigned extension during development).
REM
REM This window stays open at the end (or on error) so you can read what
REM happened - it will NOT just flash and close.

setlocal enabledelayedexpansion
set "SRC=%~dp0.."
set "TARGET=%APPDATA%\Adobe\CEP\extensions\com.fxvault.panel2"

echo ============================================
echo  FXVault installer
echo ============================================
echo Source folder: %SRC%
echo Target folder: %TARGET%
echo.

if not exist "%SRC%\CSXS\manifest.xml" (
  echo ERROR: Could not find CSXS\manifest.xml next to this script.
  echo This script must be run from inside FXVault\scripts\ - if you moved
  echo install.bat out of the FXVault folder, put it back and try again.
  goto END
)

if exist "%TARGET%" (
  echo Removing existing install at %TARGET% ...
  rmdir /S /Q "%TARGET%"
  if errorlevel 1 (
    echo ERROR: Could not remove the existing folder. Close After Effects
    echo and any Explorer windows showing that folder, then try again.
    goto END
  )
)

echo Creating target folder ...
mkdir "%TARGET%"
if errorlevel 1 (
  echo ERROR: Could not create %TARGET%
  echo Try running this script as Administrator ^(right-click ^> Run as administrator^).
  goto END
)

echo Copying files ...
xcopy "%SRC%" "%TARGET%" /E /I /H /Y
if errorlevel 1 (
  echo ERROR: xcopy reported a problem. See above for details.
  goto END
)

echo.
echo Enabling PlayerDebugMode for every CSXS version found on this machine
echo (CSXS.4 through CSXS.20 - covers all known AE releases including 2026) ...
for %%V in (4 5 6 6.1 7 8 9 10 11 12 13 14 15 16 17 18 19 20) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo Done.

echo.
echo ============================================
echo  SUCCESS
echo ============================================
echo Installed to: %TARGET%
echo Now fully quit and reopen After Effects, then:
echo   Window ^> Extensions ^> FXVault
echo.

:END
echo.
pause
endlocal
