import { useEffect, useRef } from 'react';

/**
 * Hook para capturar ráfagas de lectores láser y Bluetooth de código de barras
 * (Pistolas USB, escáneres Bluetooth, y PDAs Android como Zebra, Honeywell, Newland o Datalogic).
 *
 * Soporta ambas firmas:
 * 1. useBarcodeScanner(onScan, options)
 * 2. useBarcodeScanner({ onScan, minLength, ...options })
 *
 * @param {Function|Object} onScanOrOptions - Callback o configuración
 * @param {Object} [options] - Configuración opcional si el primer argumento es función
 */
export function useBarcodeScanner(onScanOrOptions, options = {}) {
  const isObj = typeof onScanOrOptions === 'object' && onScanOrOptions !== null;
  const onScan = isObj ? onScanOrOptions.onScan : onScanOrOptions;
  const opts = isObj ? onScanOrOptions : options;
  const minChars = opts.minChars || opts.minLength || 2;
  const maxIntervalMs = opts.maxIntervalMs || 75; // Tolerancia óptima para Bluetooth y láser Android
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
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // Enter o Tab señalan el fin de lectura del código de barras
      if (e.key === 'Enter' || e.key === 'Tab') {
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

      // Filtrar teclas modificadoras y no imprimibles (Shift, Control, Alt, CapsLock, F1-F12, etc.)
      if (e.key.length > 1) {
        return;
      }

      // Si el intervalo entre teclas fue mayor que el umbral de ráfaga y no estamos en un input, limpiar buffer previo
      if (timeDiff > maxIntervalMs && !isInput) {
        bufferRef.current = '';
      }

      // Capturar caracter
      if (!isInput) {
        bufferRef.current += e.key;
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled, minChars, maxIntervalMs]);
}
