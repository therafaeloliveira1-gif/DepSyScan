@echo off
set "JAVA_HOME=C:\Users\Marketing\java-21-openjdk-21.0.4.0.7-1.win.jdk.x86_64"
set "ANDROID_HOME=C:\Users\Marketing\AppData\Local\Android\Sdk"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

echo ========================================================
echo   MOTOS MENDES - COMPILADOR DE APK RELEASE (FIRMADO)
echo   DepSyScan para Colectores de Datos
echo ========================================================
echo.

echo [1/3] Compilando frontend web Vite...
cd /d "%~dp0"
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Fallo la compilacion de Vite.
    exit /b %errorlevel%
)

echo.
echo [2/3] Sincronizando con Capacitor Android...
if exist "android\capacitor-cordova-android-plugins" (
    rmdir /s /q "android\capacitor-cordova-android-plugins" >nul 2>&1
)
call npx cap sync android
if %errorlevel% neq 0 (
    echo [ERROR] Fallo Capacitor sync.
    exit /b %errorlevel%
)

echo.
echo [3/3] Compilando APK Release firmado con depsystem-picking.keystore...
cd /d "%~dp0android"
call gradlew.bat assembleRelease
if %errorlevel% neq 0 (
    echo [ERROR] Fallo gradlew assembleRelease.
    exit /b %errorlevel%
)

if exist "app\build\outputs\apk\release\app-release.apk" (
    copy /y "app\build\outputs\apk\release\app-release.apk" "%~dp0DepSyScan.apk"
    copy /y "app\build\outputs\apk\release\app-release.apk" "%~dp0..\DepSyScan.apk"
)

echo.
echo ========================================================
echo   [EXITO] APK firmado compilado correctamente en:
echo   %~dp0DepSyScan.apk
echo ========================================================
echo.
cd /d "%~dp0"
