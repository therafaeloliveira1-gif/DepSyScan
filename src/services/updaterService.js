/**
 * Servicio de Auto-Actualización para DepSyScan (Android / Colectores)
 * Modelo idéntico a App-venta: Descarga nativa en segundo plano con Filesystem
 * y apertura automática del instalador de Android con FileOpener (CERO navegadores).
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { Capacitor } from '@capacitor/core';
import { getServerHost } from './api';
import packageJson from '../../package.json';

export const CURRENT_VERSION = packageJson.version;
const REPO = 'therafaeloliveira1-gif/DepSyScan';

/**
 * Convierte un Blob binario a cadena Base64 para guardado seguro en filesystem
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Error al procesar el paquete APK descargado.'));
    reader.onload = () => {
      const resultStr = String(reader.result || '');
      const base64Data = resultStr.includes(',') ? resultStr.split(',')[1] : resultStr;
      resolve(base64Data);
    };
    reader.readAsDataURL(blob);
  });
}

export async function checkForPickingUpdate(currentVersion = CURRENT_VERSION) {
  try {
    // 1. Consulta pública a GitHub Releases (funciona en 4G y en Wi-Fi)
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'DepSyScan-App'
      }
    });

    if (!res.ok) {
      if (res.status === 404) return { available: false, message: 'No hay releases.' };
      return { available: false, error: `Error ${res.status}` };
    }

    const release = await res.json();
    const latestTag = (release.tag_name || '').replace(/^v/, '').trim();
    const cleanCurrent = String(currentVersion).replace(/^v/, '').trim();

    const isNewer = compareVersions(latestTag, cleanCurrent) > 0;

    if (!isNewer) {
      return { available: false, currentVersion: cleanCurrent, latestVersion: latestTag };
    }

    // Buscar el binario APK en los assets de la release
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const apkAsset = assets.find(a => a.name.endsWith('.apk'));

    // URL pública directa de descarga
    const publicDownloadUrl = apkAsset 
      ? apkAsset.browser_download_url 
      : `https://github.com/${REPO}/releases/download/v${latestTag}/DepSyScan.apk`;

    // Si está en Wi-Fi local, verificar si el servidor local está disponible
    let localDownloadUrl = 'http://192.168.1.154:3015/api/updates/DepSyScan.apk';
    try {
      const base = getServerHost().replace(/\/api\/?$/, '');
      if (base) localDownloadUrl = `${base}/api/updates/DepSyScan.apk`;
    } catch (_) {}

    return {
      available: true,
      currentVersion: cleanCurrent,
      newVersion: latestTag,
      releaseName: release.name || `DepSyScan v${latestTag}`,
      notes: release.body || 'Mejoras de rendimiento, interfaz y sincronización de depósito.',
      assetName: apkAsset ? apkAsset.name : 'DepSyScan.apk',
      assetId: apkAsset ? apkAsset.id : null,
      downloadUrl: localDownloadUrl || publicDownloadUrl,
      publicDownloadUrl,
      localDownloadUrl,
      publishedAt: release.published_at
    };
  } catch (err) {
    console.warn('[Picking Updater] Error comprobando actualización:', err);
    return { available: false, error: err.message };
  }
}

/**
 * Descarga el paquete APK en segundo plano a la memoria interna del teléfono
 * y abre de inmediato el instalador nativo de paquetes de Android (Modelo App-venta).
 */
export async function downloadAndInstallUpdate(updateInfo, onStatusChange) {
  try {
    const fileName = `DepSyScan-v${updateInfo.newVersion || 'update'}.apk`;
    const targetUrl = updateInfo.localDownloadUrl || updateInfo.downloadUrl || updateInfo.publicDownloadUrl || 'http://192.168.1.154:3015/api/updates/DepSyScan.apk';

    if (Capacitor.isNativePlatform()) {
      if (onStatusChange) onStatusChange('Descargando actualización (3.6 MB)...');

      try {
        // Intento 1: Descarga directa nativa a memoria caché
        const downloadResult = await Filesystem.downloadFile({
          url: targetUrl,
          path: fileName,
          directory: Directory.Cache
        });

        if (onStatusChange) onStatusChange('Abriendo instalador de Android...');

        let filePath = downloadResult.path;
        if (!filePath) {
          const uriObj = await Filesystem.getUri({
            path: fileName,
            directory: Directory.Cache
          });
          filePath = uriObj.uri;
        }

        await FileOpener.open({
          filePath: filePath,
          contentType: 'application/vnd.android.package-archive'
        });

        if (onStatusChange) onStatusChange('¡Instalador iniciado!');
        return;
      } catch (nativeErr) {
        console.warn('Filesystem.downloadFile falló, usando método de contingencia Blob Base64:', nativeErr);

        if (onStatusChange) onStatusChange('Descargando paquete binario...');
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} al descargar APK`);
        
        const blob = await res.blob();
        const base64Data = await blobToBase64(blob);

        if (onStatusChange) onStatusChange('Guardando en almacenamiento...');
        await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Cache
        });

        const uriObj = await Filesystem.getUri({
          path: fileName,
          directory: Directory.Cache
        });

        if (onStatusChange) onStatusChange('Abriendo instalador de Android...');
        await FileOpener.open({
          filePath: uriObj.uri,
          contentType: 'application/vnd.android.package-archive'
        });

        if (onStatusChange) onStatusChange('¡Instalador iniciado!');
        return;
      }
    }

    // Si estuviera en navegador web PC
    if (onStatusChange) onStatusChange('Descargando archivo...');
    window.location.href = targetUrl;

  } catch (error) {
    console.error('Error al descargar/instalar actualización:', error);
    throw new Error(error.message || 'Error al procesar el paquete APK.');
  }
}

function compareVersions(v1, v2) {
  const p1 = (v1 || '').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = (v2 || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

