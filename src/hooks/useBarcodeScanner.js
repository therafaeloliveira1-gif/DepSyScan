import { useEffect, useRef } from 'react';

/**
 * Hook para capturar ráfagas de lectores láser y Bluetooth de código de barras
 * (Pistolas USB, escáneres Bluetooth, y PDAs Android como Zebra, Honeywell, Newland o Datalogic).
 *
 * Soporta ambas firmas:
 * 1. useBarcodeScanner(onScan, options)
 * 2. useBarcodeScanner({ onScan, minLength, ...options })
 */
export function useBarcodeScanner(onScanOrOptions, options = {}) {
  const isObj = typeof onScanOrOptions === 'object' && onScanOrOptions !== null;
  const onScan = isObj ? onScanOrOptions.onScan : onScanOrOptions;
  const opts = isObj ? onScanOrOptions : options;
  const minChars = opts.minChars || opts.minLength || 2;
  const maxIntervalMs = opts.maxIntervalMs || 100; // Tolerancia amplia para Bluetooth Android
  const enabled = opts.enabled !== false;

  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e) {
      const target = e.target;
      // Solo ignorar si es un input manual tradicional editable por teclado virtual
      const isVisibleManualInput = target && 
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && 
        target.getAttribute('inputmode') !== 'none';

      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // Enter o Tab o keyCode 13 señalan el fin de lectura del código de barras
      if (e.key === 'Enter' || e.key === 'Tab' || e.keyCode === 13 || e.which === 13) {
        if (bufferRef.current.length >= minChars) {
          e.preventDefault();
          e.stopPropagation();
          const scannedCode = bufferRef.current.trim();
          bufferRef.current = '';
          if (typeof onScanRef.current === 'function') {
            onScanRef.current(scannedCode);
          }
        }
        return;
      }

      // Obtener caracter, con fallback a keyCode para Android cuando e.key viene como 'Unidentified'
      let charToAdd = '';
      if (e.key && e.key.length === 1) {
        charToAdd = e.key;
      } else if (e.keyCode >= 48 && e.keyCode <= 57) { // Dígitos 0-9
        charToAdd = String.fromCharCode(e.keyCode);
      } else if (e.keyCode >= 96 && e.keyCode <= 105) { // Numpad 0-9
        charToAdd = String(e.keyCode - 96);
      } else if (e.keyCode >= 65 && e.keyCode <= 90) { // Letras A-Z
        charToAdd = String.fromCharCode(e.keyCode);
      }

      if (!charToAdd) return;

      // Si el intervalo entre teclas fue mayor que el umbral de ráfaga y no estamos en un input manual, reiniciar
      if (timeDiff > maxIntervalMs && !isVisibleManualInput) {
        bufferRef.current = '';
      }

      // Capturar caracter
      if (!isVisibleManualInput) {
        bufferRef.current += charToAdd;
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled, minChars, maxIntervalMs]);
}
