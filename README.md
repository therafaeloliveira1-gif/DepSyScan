# DepSyScan • Aplicación Móvil de Picking y Recolección

Aplicación móvil oficial de **DepSyScan** para operarios recolectores y separadores de depósito de **Motos Mendes S.A.** Desarrollada en **React + Vite + Capacitor** para terminales y colectores de datos Android.

## 📱 Capacidades Principales
- **Lectura Láser / Colector de Datos:** Integración con escáneres de código de barras 1D y 2D.
- **Flujo de Picking Guiado:** Indicación de pasillos, estanterías y validación de bips en tiempo real.
- **Gestión de Discrepancias y Faltantes:** Notificación inmediata a supervisión y control de reintentos.
- **Auto-Actualización Nativa:** Detección y descarga automática de nuevos APKs desde GitHub Releases.

## 🚀 Compilación y Publicación
```bash
# Compilar frontend y APK con Capacitor
npm run build
npx cap sync android
# Compilación del APK (debug / release)
.\build_release.ps1
```

---
*© Motos Mendes S.A. • Todos los derechos reservados.*
