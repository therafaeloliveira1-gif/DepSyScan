$ErrorActionPreference = "Stop"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " MOTOS MENDES - COMPILADOR APK (DEPSYSCAN)" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Compilar Frontend Vite
Write-Host "`n[1/3] Compilando frontend web Vite..." -ForegroundColor Yellow
Set-Location "C:\WorkSpace\DepSyS\DepSyScan"
npm run build

# 2. Sincronizar Capacitor
Write-Host "`n[2/3] Sincronizando assets nativos con Capacitor..." -ForegroundColor Yellow
npx cap sync android

# 3. Compilar con Gradle
Write-Host "`n[3/3] Compilando APK con Gradle..." -ForegroundColor Yellow
$env:JAVA_HOME = "C:\Users\Marketing\java-21-openjdk-21.0.4.0.7-1.win.jdk.x86_64"
$env:ANDROID_HOME = "C:\Users\Marketing\AppData\Local\Android\Sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

Set-Location "C:\WorkSpace\DepSyS\DepSyScan\android"
cmd.exe /c "gradlew.bat assembleDebug"

$debugApk = "C:\WorkSpace\DepSyS\DepSyScan\android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $debugApk) {
    Copy-Item -Path $debugApk -Destination "C:\WorkSpace\DepSyS\DepSyScan\DepSyScan.apk" -Force
    Copy-Item -Path $debugApk -Destination "C:\WorkSpace\DepSyS\DepSyScan.apk" -Force
    
    $size = (Get-Item "C:\WorkSpace\DepSyS\DepSyScan.apk").Length / 1MB
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host " [EXITO] APK generado correctamente:" -ForegroundColor Green
    Write-Host " C:\WorkSpace\DepSyS\DepSyScan.apk ($([math]::Round($size, 2)) MB)" -ForegroundColor White
    Write-Host "========================================================`n" -ForegroundColor Green
} else {
    Write-Error "No se encontró el archivo generado en $debugApk"
}
