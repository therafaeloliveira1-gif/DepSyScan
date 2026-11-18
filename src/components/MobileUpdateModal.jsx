import React, { useState } from 'react';
import { ArrowDownCircle, Smartphone, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { downloadAndInstallUpdate } from '../services/updaterService';

export default function MobileUpdateModal({ updateInfo, onClose }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);

  if (!updateInfo || !updateInfo.available) return null;

  async function handleDownloadAndInstall() {
    try {
      setIsDownloading(true);
      setErrorMsg(null);
      await downloadAndInstallUpdate(updateInfo, (status) => {
        setStatusMessage(status);
      });
    } catch (err) {
      console.error('Error instalando actualización:', err);
      setErrorMsg(err.message || 'Error al descargar o abrir el instalador del paquete APK.');
      setIsDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-zinc-200 animate-in slide-in-from-bottom-6 duration-300">
        
        {/* Cabecera */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-[#e60000]">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#e60000]">
                  Actualización DepSyScan
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-zinc-100 text-zinc-700">
                  v{updateInfo.newVersion}
                </span>
              </div>
              <h3 className="text-sm font-black text-zinc-900 mt-0.5">
                Nueva versión del Colector
              </h3>
            </div>
          </div>

          {!isDownloading && (
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-700 p-1"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Comparador de versiones */}
        <div className="py-3">
          <div className="flex items-center justify-between bg-zinc-50 p-3 rounded-xl mb-3 border border-zinc-200/80">
            <div className="text-center flex-1 border-r border-zinc-200 pr-2">
              <span className="text-[10px] font-semibold text-zinc-400 block uppercase tracking-wider">Instalada</span>
              <span className="text-xs font-bold text-zinc-600">v{updateInfo.currentVersion}</span>
            </div>
            <div className="px-3 text-red-500 font-bold">→</div>
            <div className="text-center flex-1 pl-2">
              <span className="text-[10px] font-semibold text-[#e60000] block uppercase tracking-wider">Disponible</span>
              <span className="text-sm font-extrabold text-[#e60000]">v{updateInfo.newVersion}</span>
            </div>
          </div>

          <p className="text-xs text-zinc-600 mb-2">
            Mejoras en el lector láser, variantes de cronómetro e instalador automático directo.
          </p>

          <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl text-xs text-zinc-500 max-h-24 overflow-y-auto">
            {updateInfo.notes || 'Mejoras de rendimiento, interfaz y sincronización de depósito.'}
          </div>
        </div>

        {/* Mensaje de error si falla */}
        {errorMsg && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <span className="flex-1 leading-tight">{errorMsg}</span>
          </div>
        )}

        {/* Acciones */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={handleDownloadAndInstall}
            disabled={isDownloading}
            className={`w-full py-3.5 bg-[#e60000] hover:bg-[#cc0000] active:bg-[#b30000] text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-red-600/30 transition-all flex items-center justify-center gap-2 ${
              isDownloading ? 'opacity-85 cursor-wait' : ''
            }`}
          >
            {isDownloading ? (
              <>
                <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{statusMessage || 'Descargando actualización...'}</span>
              </>
            ) : (
              <>
                <ArrowDownCircle className="w-4 h-4" />
                <span>Instalar Actualización Automática</span>
              </>
            )}
          </button>

          {!isDownloading && (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 text-zinc-400 hover:text-zinc-600 text-xs font-medium text-center"
            >
              Continuar trabajando
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

