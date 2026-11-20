@echo off
setlocal
pushd "%~dp0" || exit /b 1

where /q node.exe
if errorlevel 1 goto findBundledRuntime
where /q pnpm
if not errorlevel 1 goto checkDependencies

:findBundledRuntime
set "LITTLE_EXPEDITION_RUNTIME="
for /f "usebackq delims=" %%D in (`powershell.exe -NoProfile -Command "$runtime = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' | Sort-Object Version -Descending | Select-Object -First 1; if ($runtime) { Join-Path $runtime.InstallLocation 'dependencies' }"`) do set "LITTLE_EXPEDITION_RUNTIME=%%D"
if defined LITTLE_EXPEDITION_RUNTIME set "PATH=%LITTLE_EXPEDITION_RUNTIME%\node\bin;%LITTLE_EXPEDITION_RUNTIME%\bin\fallback;%PATH%"
where /q node.exe
if errorlevel 1 goto missingRuntime
where /q pnpm
if errorlevel 1 goto missingRuntime

:checkDependencies
if exist "node_modules\.bin\vite.cmd" if exist "node_modules\phaser\package.json" goto serve
echo Installing Little Expedition dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 goto failed

:serve
echo Starting Little Expedition...
echo Press Ctrl+C to stop the game server.
call pnpm dev --host 127.0.0.1 --open
if errorlevel 1 goto failed
popd
exit /b 0

:missingRuntime
echo Node.js and pnpm were not found. Install Node.js 24 and pnpm 11 and try again.
goto showError

:failed
echo Little Expedition could not start. See the error above.

:showError
pause
popd
exit /b 1
