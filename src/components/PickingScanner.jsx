import React, { useState, useEffect, useRef } from 'react';
import {
  Clock,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  Send,
  Zap,
  PackageX,
  X,
  AlertCircle,
  RefreshCw,
  Package
} from 'lucide-react';
import ItemProgressCard from './ItemProgressCard';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import {
  playBeepSuccess,
  playBeepError,
  playItemCompleted,
  playOrderCompleted
} from '../services/audioService';
import { registrarBip, reportarFaltanteApi, fetchPedidoReal } from '../services/api';

// Textura SVG de ruido al 30% para acabado analógico sobre gradientes
const NOISE_BG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`;

export default function PickingScanner({
  pedido,
  operario,
  onCompletePicking,
  onFinishErrorDelivery,
  pausedPedido = null,
  isGlobalPaused = false
}) {
  const [items, setItems] = useState(pedido.items || []);
  const [loadingItems, setLoadingItems] = useState(!pedido.items || pedido.items.length === 0);
  const [loadError, setLoadError] = useState(null);
  const [lastScannedSku, setLastScannedSku] = useState(null);
  const [bipsTotal, setBipsTotal] = useState(pedido.total_bips_realizados || 0);
  const [elapsedMs, setElapsedMs] = useState(() => {
    const tInicio = pedido.inicio_separacion
      ? new Date(pedido.inicio_separacion).getTime()
      : Date.now();
    const startTs = isNaN(tInicio) ? Date.now() : tInicio;
    return Math.max(0, Date.now() - startTs);
  });
  const [flashColor, setFlashColor] = useState(null); // 'green' | 'red'

  // Recarga reactiva de seguridad para asegurar ítems de la nota desde SGLoja / MySQL
  async function recargarItems() {
    if (!pedido?.num_pedido) return;
    setLoadingItems(true);
    setLoadError(null);
    try {
      const res = await fetchPedidoReal(pedido.num_pedido);
      if (res && res.success && Array.isArray(res.items) && res.items.length > 0) {
        setItems(res.items);
      } else {
        setLoadError(res?.error || 'No se recibieron repuestos para esta nota.');
      }
    } catch (err) {
      setLoadError('Error de red al consultar repuestos.');
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    if ((!items || items.length === 0) && pedido && pedido.num_pedido) {
      recargarItems();
    }
  }, [pedido]);

  // Polling ágil en segundo plano para detectar si el supervisor halló o confirmó un faltante
  useEffect(() => {
    if (!pedido?.num_pedido || pedido.estado === 'ERROR_SEPARACION') return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetchPedidoReal(pedido.num_pedido);
        if (!isMounted || !res || !res.success || !Array.isArray(res.items)) return;

        setItems(prevItems => {
          let huboCambio = false;
          let itemHalladoInfo = null;

          const updated = prevItems.map(prev => {
            const nuevo = res.items.find(it => String(it.sku) === String(prev.sku) || it.id === prev.id);
            if (!nuevo) return prev;

            // 1. Si el supervisor encontró el repuesto en depósito (HALLADO):
            if (prev.es_faltante === 1 && nuevo.es_faltante === 0) {
              huboCambio = true;
              itemHalladoInfo = nuevo;
              return {
                ...prev,
                es_faltante: 0,
                faltante_aprobado: 0,
                ubicacion: nuevo.ubicacion || prev.ubicacion
              };
            }

            // 2. Si el supervisor confirmó el faltante:
            if (!prev.faltante_aprobado && nuevo.faltante_aprobado === 1) {
              huboCambio = true;
              return {
                ...prev,
                faltante_aprobado: 1
              };
            }

            return prev;
          });

          if (itemHalladoInfo) {
            playBeepSuccess();
            setNotificacionFlotante({
              tipo: 'alerta',
              titulo: '🎯 ¡REPUESTO HALLADO POR SUPERVISOR!',
              mensaje: `El repuesto SKU ${itemHalladoInfo.sku} fue hallado en: ${itemHalladoInfo.ubicacion || 'Depósito'}. Ya está reactivado para bipedear.`
            });
            setTimeout(() => setNotificacionFlotante(null), 8000);
          }

          return huboCambio ? updated : prevItems;
        });
      } catch (_) { }
    }, 3500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [pedido?.num_pedido, pedido?.estado]);

  // Sincronizar tiempo inicial al cambiar de nota
  useEffect(() => {
    const isError = pedido.estado === 'ERROR_SEPARACION';
    const rawTime = (isError && pedido.fecha_inicio_error)
      ? pedido.fecha_inicio_error
      : pedido.inicio_separacion;
    const tInicio = rawTime ? new Date(rawTime).getTime() : Date.now();
    const startTs = isNaN(tInicio) ? Date.now() : tInicio;
    const diff = Date.now() - startTs;

    // Si la diferencia supera 6 horas sin bips o viene de un día anterior, resetear a 0 (excepto si es error activo)
    if (diff > 6 * 3600 * 1000 && (!bipsTotal || bipsTotal === 0) && !isError) {
      setElapsedMs(0);
    } else {
      setElapsedMs(Math.max(0, diff));
    }
  }, [pedido.id, pedido.inicio_separacion, pedido.fecha_inicio_error, pedido.estado]);

  // Información de error de separación parseada si aplica
  const errorInfo = typeof pedido?.error_detalle === 'string'
    ? (() => { try { return JSON.parse(pedido.error_detalle); } catch (_) { return null; } })()
    : pedido?.error_detalle;

  // Estado para el modal de reporte de faltante
  const [faltanteModalItem, setFaltanteModalItem] = useState(null);
  const [faltanteMotivo, setFaltanteMotivo] = useState('Estante vacío');
  const [enviandoFaltante, setEnviandoFaltante] = useState(false);
  const [notificacionFlotante, setNotificacionFlotante] = useState(null);

  // Cronómetro de picking en vivo: SE CONGELA automáticamente si hay pausa global del supervisor
  useEffect(() => {
    if (isGlobalPaused) return; // Congelado durante la pausa maestra del depósito

    const timer = setInterval(() => {
      setElapsedMs(ms => ms + 50);
    }, 50);

    return () => clearInterval(timer);
  }, [isGlobalPaused]);

  const totalSecs = Math.floor(elapsedMs / 1000);
  const minDigits = String(Math.floor(totalSecs / 60)).padStart(2, '0');
  const secDigits = String(totalSecs % 60).padStart(2, '0');
  const msDigits = String(Math.floor((elapsedMs % 1000) / 10)).padStart(2, '0');

  // Sincronizar el pedido activo en localStorage para reanudar automáticamente al día siguiente
  useEffect(() => {
    try {
      localStorage.setItem('depsystem_active_pedido', JSON.stringify({
        ...pedido,
        items,
        total_bips_realizados: bipsTotal
      }));
    } catch (e) {
      console.warn('Error sincronizando active_pedido en localStorage:', e);
    }
  }, [items, bipsTotal, pedido]);

  // Totales
  const totalPiezasRequeridas = items.reduce((acc, it) => acc + it.cantidad_requerida, 0);
  const totalPiezasBipadas = items.reduce((acc, it) => acc + (it.cantidad_bipada || 0), 0);
  const totalFaltantes = items.filter(it => it.es_faltante === 1).length;

  // Un pedido se puede finalizar si cada ítem está completo O marcado como faltante
  const isOrderFinished = items.length > 0 && items.every(it =>
    (it.cantidad_bipada >= it.cantidad_requerida) || it.es_faltante === 1
  );

  // EL TIEMPO DE ERROR SOLO CORRE SI LA MESA DEVOLVIÓ LA NOTA POR PIEZA EQUIVOCADA (ERROR_SEPARACION)
  // Un faltante en estante ('NO HAY') NO es error del separador; el cronómetro sigue corriendo como tiempo normal de picking.
  const isErrorSeparacion = pedido.estado === 'ERROR_SEPARACION';
  const cronometroModo = isGlobalPaused
    ? 'PAUSA'
    : isErrorSeparacion
      ? 'ERROR'
      : 'PICKING';

  const progressPercent = totalPiezasRequeridas > 0
    ? Math.min(100, Math.round(((totalPiezasBipadas + items.filter(it => it.es_faltante === 1).reduce((a, b) => a + (b.cantidad_requerida - b.cantidad_bipada), 0)) / totalPiezasRequeridas) * 100))
    : 0;

  // Manejador central de escaneo láser
  async function procesarCodigoEscaneado(codigoRaw) {
    if (!codigoRaw) return;
    const cleanCode = String(codigoRaw).trim().toUpperCase();

    // Si el pedido está en ERROR DE SEPARACIÓN (la mesa pidió corregir un producto)
    if (pedido.estado === 'ERROR_SEPARACION') {
      const skuEsperado = String(errorInfo?.sku_correcto || '').trim().toUpperCase();
      const matchError = cleanCode === skuEsperado;

      // Buscar si coincide con el SKU o con algún ítem de la nota
      const targetIndex = items.findIndex(it =>
        String(it.sku).trim().toUpperCase() === cleanCode ||
        String(it.codigo_barra).trim().toUpperCase() === cleanCode
      );

      if (matchError || (targetIndex !== -1 && items[targetIndex].sku.toUpperCase() === skuEsperado)) {
        playItemCompleted();
        triggerFlash('green');
        registrarBip(pedido.id_deposito || pedido.id, operario.id, skuEsperado);
        setBipsTotal(b => b + 1);
        setLastScannedSku(skuEsperado);

        setNotificacionFlotante({
          tipo: 'success',
          titulo: '¡REPUESTO CORRECTO VALIDADO!',
          mensaje: `Lleva el repuesto a la Mesa ${pedido.mesa_codigo || '301'} para que el operador confirme la recepción y finalice el tiempo de error.`
        });
        return;
      } else {
        // Bipeó otra cosa durante el error
        playBeepError();
        triggerFlash('red');
        registrarBip(pedido.id_deposito || pedido.id, operario.id, cleanCode);
        setNotificacionFlotante({
          tipo: 'error',
          titulo: '⚠️ CÓDIGO NO COINCIDE',
          mensaje: `Debes buscar el SKU ${skuEsperado || 'solicitado por mesa'}. Código escaneado: ${cleanCode}`
        });
        return;
      }
    }

    // 1. Buscar coincidencia en flujo de picking normal
    const targetIndex = items.findIndex(it =>
      String(it.sku).trim().toUpperCase() === cleanCode ||
      String(it.codigo_barra).trim().toUpperCase() === cleanCode
    );

    if (targetIndex === -1) {
      // ❌ Código incorrecto
      playBeepError();
      triggerFlash('red');
      registrarBip(pedido.id_deposito || pedido.id, operario.id, cleanCode);
      return;
    }

    const currentItem = items[targetIndex];

    // Verificar si ya está completo o marcado como faltante
    if (currentItem.cantidad_bipada >= currentItem.cantidad_requerida) {
      playBeepSuccess();
      triggerFlash('green');
      return;
    }

    // ✅ Coincidencia válida
    const newQty = (currentItem.cantidad_bipada || 0) + 1;
    const isNowComplete = newQty >= currentItem.cantidad_requerida;

    if (isNowComplete) {
      playItemCompleted();
    } else {
      playBeepSuccess();
    }
    triggerFlash('green');

    // Registrar en BD asynchronously
    registrarBip(pedido.id_deposito || pedido.id, operario.id, currentItem.sku);
    setBipsTotal(b => b + 1);
    setLastScannedSku(currentItem.sku);

    // Actualizar estado local
    setItems(prevItems => {
      const updated = [...prevItems];
      updated[targetIndex] = {
        ...updated[targetIndex],
        cantidad_bipada: newQty
      };

      // Si se completó toda la orden tras este bip, sonido de fin
      const willBeAllDone = updated.every(it =>
        (it.cantidad_bipada >= it.cantidad_requerida) || it.es_faltante === 1
      );
      if (willBeAllDone) {
        setTimeout(playOrderCompleted, 300);
      }

      return updated;
    });
  }

  // Hook del lector de código de barras físico del colector
  useBarcodeScanner({
    onScan: procesarCodigoEscaneado,
    minLength: 2
  });

  function triggerFlash(color) {
    setFlashColor(color);
    setTimeout(() => setFlashColor(null), 250);
  }

  function handleManualIncrement(item) {
    procesarCodigoEscaneado(item.sku);
  }

  function handleOpenFaltanteModal(item) {
    setFaltanteModalItem(item);
    setFaltanteMotivo('Estante vacío');
  }

  async function handleConfirmarFaltante() {
    if (!faltanteModalItem) return;
    setEnviandoFaltante(true);

    try {
      const notaId = pedido.id_deposito || pedido.id || pedido.num_pedido;
      const itemId = faltanteModalItem.id || faltanteModalItem.sku;
      const res = await reportarFaltanteApi(
        notaId,
        itemId,
        operario.id,
        faltanteMotivo
      );

      if (res && res.success) {
        // Marcar localmente como faltante
        setItems(prev => prev.map(it => {
          if (it.sku === faltanteModalItem.sku) {
            return {
              ...it,
              es_faltante: 1,
              faltante_motivo: faltanteMotivo,
              faltante_aprobado: res.aprobadoAuto ? 1 : 0
            };
          }
          return it;
        }));

        // Feedback al operario
        if (res.tieneStockErp) {
          setNotificacionFlotante({
            tipo: 'alerta',
            titulo: 'Discrepancia Notificada al Supervisor',
            mensaje: `El ERP indica stock disponible (${res.stockErp} unid). El supervisor lo buscará físicamente mientras tú continuas con el resto.`
          });
        } else {
          setNotificacionFlotante({
            tipo: 'info',
            titulo: 'Faltante Aprobado en Sistema',
            mensaje: 'Stock en sistema confirmado en 0.'
          });
        }
      } else {
        alert('Error registrando faltante: ' + (res?.error || 'Error de red'));
      }
    } catch (err) {
      alert('Error de conexión reportando faltante');
    } finally {
      setEnviandoFaltante(false);
      setFaltanteModalItem(null);
      setTimeout(() => setNotificacionFlotante(null), 4500);
    }
  }

  function formatTimer(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // Ordenar: primero los pendientes, luego faltantes, al final completados
  const sortedItems = [...items].sort((a, b) => {
    const aComp = a.cantidad_bipada >= a.cantidad_requerida;
    const bComp = b.cantidad_bipada >= b.cantidad_requerida;
    if (aComp !== bComp) return aComp ? 1 : -1;
    if (a.es_faltante !== b.es_faltante) return a.es_faltante ? 1 : -1;
    return 0;
  });

  return (
    <div className={`flex flex-col h-full max-w-md mx-auto safe-area-top safe-area-bottom px-3.5 sm:px-4 transition-colors duration-200 relative select-none ${flashColor === 'green' ? 'bg-emerald-50' : flashColor === 'red' ? 'bg-red-50' : ''
      }`}>
      {/* Notificación Flotante de Faltante / ERP */}
      {notificacionFlotante && (
        <div className="fixed top-[max(env(safe-area-inset-top,0px),1rem)] left-4 right-4 z-50 p-3.5 rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-top-4">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h5 className="font-bold text-xs uppercase tracking-wider text-amber-800">
                {notificacionFlotante.titulo}
              </h5>
              <p className="text-xs text-amber-900 mt-0.5 leading-relaxed">
                {notificacionFlotante.mensaje}
              </p>
            </div>
            <button
              onClick={() => setNotificacionFlotante(null)}
              className="text-amber-600 hover:text-amber-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Cronómetro Inteligente Multimodo 3D (MIN : SEC : MS) */}
      <div className="w-full grid grid-cols-3 gap-1.5 sm:gap-2 mb-2">
        {/* Card MIN */}
        <div className={`relative overflow-hidden rounded-2xl py-1.5 sm:py-2 px-1 flex flex-col items-center justify-center transition-all duration-300 ${cronometroModo === 'PICKING'
          ? 'bg-white border border-zinc-100 shadow-[4px_6px_14px_rgba(0,0,0,0.06),-3px_-3px_8px_rgba(255,255,255,0.95)]'
          : cronometroModo === 'ERROR'
            ? 'bg-amber-50/40 border border-amber-300 shadow-[0_4px_14px_rgba(245,158,11,0.2)] ring-1 ring-amber-400/40'
            : 'bg-amber-50/70 border border-amber-400 shadow-md ring-1 ring-amber-500/30'
          }`}>
          <div
            className="absolute inset-0 pointer-events-none opacity-30 mix-blend-overlay z-10"
            style={{ backgroundImage: NOISE_BG }}
          />
          <span className={`font-heading font-black text-xl sm:text-3xl tracking-tight leading-none bg-clip-text text-transparent relative z-0 transition-all ${cronometroModo === 'PICKING'
            ? 'bg-gradient-to-b from-[#ff2a2a] via-[#e60000] to-[#800000]'
            : cronometroModo === 'ERROR'
              ? 'bg-gradient-to-b from-amber-500 via-amber-600 to-orange-700'
              : 'bg-gradient-to-b from-amber-600 via-amber-700 to-amber-900'
            }`}>
            {minDigits}
          </span>
          <span className={`text-[8px] sm:text-[9px] font-mono font-extrabold tracking-widest uppercase mt-0.5 sm:mt-1 relative z-0 ${cronometroModo === 'PICKING'
            ? 'text-[#cc0000]/70'
            : cronometroModo === 'ERROR'
              ? 'text-amber-700'
              : 'text-amber-800'
            }`}>
            MIN
          </span>
        </div>

        {/* Card SEC */}
        <div className={`relative overflow-hidden rounded-2xl py-1.5 sm:py-2 px-1 flex flex-col items-center justify-center transition-all duration-300 ${cronometroModo === 'PICKING'
          ? 'bg-white border border-zinc-100 shadow-[4px_6px_14px_rgba(0,0,0,0.06),-3px_-3px_8px_rgba(255,255,255,0.95)]'
          : cronometroModo === 'ERROR'
            ? 'bg-amber-50/40 border border-amber-300 shadow-[0_4px_14px_rgba(245,158,11,0.2)] ring-1 ring-amber-400/40'
            : 'bg-amber-50/70 border border-amber-400 shadow-md ring-1 ring-amber-500/30'
          }`}>
          <div
            className="absolute inset-0 pointer-events-none opacity-30 mix-blend-overlay z-10"
            style={{ backgroundImage: NOISE_BG }}
          />
          <span className={`font-heading font-black text-xl sm:text-3xl tracking-tight leading-none bg-clip-text text-transparent relative z-0 transition-all ${cronometroModo === 'PICKING'
            ? 'bg-gradient-to-b from-[#ff2a2a] via-[#e60000] to-[#800000]'
            : cronometroModo === 'ERROR'
              ? 'bg-gradient-to-b from-amber-500 via-amber-600 to-orange-700'
              : 'bg-gradient-to-b from-amber-600 via-amber-700 to-amber-900'
            }`}>
            {secDigits}
          </span>
          <span className={`text-[8px] sm:text-[9px] font-mono font-extrabold tracking-widest uppercase mt-0.5 sm:mt-1 relative z-0 ${cronometroModo === 'PICKING'
            ? 'text-[#cc0000]/70'
            : cronometroModo === 'ERROR'
              ? 'text-amber-700'
              : 'text-amber-800'
            }`}>
            SEC
          </span>
        </div>

        {/* Card MS */}
        <div className={`relative overflow-hidden rounded-2xl py-1.5 sm:py-2 px-1 flex flex-col items-center justify-center transition-all duration-300 ${cronometroModo === 'PICKING'
          ? 'bg-white border border-zinc-100 shadow-[4px_6px_14px_rgba(0,0,0,0.06),-3px_-3px_8px_rgba(255,255,255,0.95)]'
          : cronometroModo === 'ERROR'
            ? 'bg-amber-50/40 border border-amber-300 shadow-[0_4px_14px_rgba(245,158,11,0.2)] ring-1 ring-amber-400/40'
            : 'bg-amber-50/70 border border-amber-400 shadow-md ring-1 ring-amber-500/30'
          }`}>
          <div
            className="absolute inset-0 pointer-events-none opacity-30 mix-blend-overlay z-10"
            style={{ backgroundImage: NOISE_BG }}
          />
          <span className={`font-heading font-black text-xl sm:text-3xl tracking-tight leading-none bg-clip-text text-transparent relative z-0 transition-all ${cronometroModo === 'PICKING'
            ? 'bg-gradient-to-b from-[#ff2a2a] via-[#e60000] to-[#800000]'
            : cronometroModo === 'ERROR'
              ? 'bg-gradient-to-b from-amber-500 via-amber-600 to-orange-700'
              : 'bg-gradient-to-b from-amber-600 via-amber-700 to-amber-900'
            }`}>
            {msDigits}
          </span>
          <span className={`text-[8px] sm:text-[9px] font-mono font-extrabold tracking-widest uppercase mt-0.5 sm:mt-1 relative z-0 ${cronometroModo === 'PICKING'
            ? 'text-[#cc0000]/70'
            : cronometroModo === 'ERROR'
              ? 'text-amber-700'
              : 'text-amber-800'
            }`}>
            MS
          </span>
        </div>
    </div>

      {/* Info de la Nota y Cliente con Indicador de Discrepancia si aplica */ }
  <div className="flex items-center justify-between px-1 mb-2 text-xs font-mono">
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`font-black tracking-wider px-2 py-0.5 rounded-md transition-all ${cronometroModo === 'ERROR'
        ? 'bg-amber-100 text-amber-900 border border-amber-300'
        : 'bg-red-50 text-[#e60000] border border-red-100'
        }`}>
        NOTA #{pedido.num_pedido}
      </span>
      {isErrorSeparacion ? (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500 text-black shadow-xs animate-pulse">
          🚨 ERROR DE PRODUCTO EN MESA
        </span>
      ) : totalFaltantes > 0 ? (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 border border-zinc-200">
          {totalFaltantes} faltante(s)
        </span>
      ) : null}
    </div>
    <span className="font-heading font-bold text-zinc-800 truncate max-w-[180px] text-right">
      {pedido.cliente_nombre || 'Cliente'}
    </span>
  </div>

  {/* Tarjeta Heroica Urgente: Cuando la Mesa reportó que se trajo producto equivocado */ }
  {
    pedido.estado === 'ERROR_SEPARACION' && (
      <div className="mb-2.5 p-4 rounded-2xl bg-[#121214] border-2 border-amber-500 text-white shadow-xl space-y-3 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
            <h3 className="font-heading font-black text-xs uppercase tracking-wider text-amber-400">
              Corrección Exigida por Mesa {pedido.mesa_codigo || '301'}
            </h3>
          </div>
          <span className="text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-md font-bold">
            Tiempo Error Activo
          </span>
        </div>

      {/* Banner de Nota Pausada por Emergencia */}
      {pedido.estado === 'ERROR_SEPARACION' && pausedPedido && (
        <div className="mb-2.5 p-3 rounded-2xl bg-amber-500/15 border-2 border-dashed border-amber-500/60 text-amber-950 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600 animate-ping shrink-0"></span>
            <div>
              <p className="text-[11px] font-heading font-black text-amber-950 uppercase tracking-wider">
                ⏸️ Tu Nota #{pausedPedido.num_pedido} fue pausada
              </p>
              <p className="text-[10px] text-amber-800 font-mono">
                Se reanudará automáticamente al entregar en Mesa {pedido.mesa_codigo || '301'}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold bg-amber-300 text-amber-950 px-2 py-1 rounded-lg shrink-0">
            PAUSA
          </span>
        </div>
      )}

        {errorInfo && (
          <div className="space-y-2">
            <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400">Pieza errónea a devolver:</span>
              <span className="text-red-400 font-bold line-through">
                {errorInfo.codigo_equivocado || 'DESCONOCIDO'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40">
              <p className="text-[10px] font-mono uppercase text-amber-300 font-black tracking-wider mb-1">
                👉 REPUESTO CORRECTO A BUSCAR
              </p>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono font-black text-xl text-amber-400 tracking-tight">
                  {errorInfo.sku_correcto}
                </span>
                <span className="font-mono font-bold text-xs bg-zinc-900 text-white border border-zinc-700 px-2.5 py-1 rounded-lg">
                  📍 {errorInfo.ubicacion || 'PAS-01'}
                </span>
              </div>
              <p className="text-xs text-zinc-200 line-clamp-2 font-medium">
                {errorInfo.descripcion_correcta}
              </p>
              <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>Cantidad: <strong className="text-white">{errorInfo.cantidad_requerida || 1} pieza(s)</strong></span>
                <span className="text-amber-300 font-bold">Llevar a Mesa {pedido.mesa_codigo || '301'}</span>
              </div>
            </div>
          </div>
        )}

        <p className="text-[11px] text-zinc-400 font-mono text-center">
          Escanea la pieza correcta en el estante y entrégala en mesa.
        </p>
      </div>
    )
  }

  {/* Telemetría de Avance (Bento Card Móvil Responsiva) */ }
  <div className="p-3 sm:p-4 bg-white rounded-2xl border border-zinc-200 mb-2.5 shadow-sm">
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-baseline gap-1.5 sm:gap-2">
        <span className="text-xl sm:text-2xl font-heading font-black text-zinc-900">
          {totalPiezasBipadas}
        </span>
        <span className="text-xs sm:text-sm text-zinc-500 font-mono">
          / {totalPiezasRequeridas} piezas
        </span>
        {totalFaltantes > 0 && (
          <span className="text-[10px] sm:text-xs font-mono font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-300">
            {totalFaltantes} faltante(s)
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 border border-zinc-200">
          {bipsTotal} bips
        </span>
        <span className="text-sm sm:text-base font-heading font-black text-[#e60000]">
          {progressPercent}%
        </span>
      </div>
    </div>

    {/* Barra de Progreso */}
    <div className="w-full h-2.5 bg-zinc-100 rounded-full overflow-hidden">
      <div
        className={`h-full transition-all duration-300 rounded-full ${totalFaltantes > 0
          ? 'bg-gradient-to-r from-amber-500 to-emerald-500'
          : 'bg-gradient-to-r from-[#e60000] to-emerald-500'
          }`}
        style={{ width: `${progressPercent}%` }}
      />
    </div>
  </div>

  {/* Lista de Repuestos: Scroll Fluido con Skeletons y Estados Vacíos Claros */}
  <div className="flex-1 min-h-0 overflow-y-auto space-y-2 sm:space-y-2.5 pr-0.5 mb-2">
    {loadingItems ? (
      <div className="p-6 text-center space-y-3 bg-white border border-zinc-200 rounded-2xl shadow-sm animate-pulse">
        <div className="w-10 h-10 mx-auto rounded-full bg-red-100 text-[#e60000] flex items-center justify-center">
          <RefreshCw className="w-5 h-5 animate-spin" />
        </div>
        <div>
          <h4 className="font-heading font-bold text-sm text-zinc-800">
            Cargando repuestos de la nota #{pedido.num_pedido}...
          </h4>
          <p className="text-xs text-zinc-400 mt-1">
            Sincronizando ítems y ubicaciones en depósito
          </p>
        </div>
      </div>
    ) : sortedItems.length === 0 ? (
      <div className="p-6 text-center space-y-3 bg-white border border-zinc-200 rounded-2xl shadow-sm">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-zinc-100 text-zinc-400 flex items-center justify-center">
          <Package className="w-6 h-6" />
        </div>
        <div>
          <h4 className="font-heading font-bold text-sm text-zinc-900">
            Sin repuestos visibles en esta nota
          </h4>
          <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
            {loadError || 'Es posible que el pedido aún no haya sincronizado sus líneas desde el ERP.'}
          </p>
        </div>
        <button
          type="button"
          onClick={recargarItems}
          className="mt-2 py-2 px-4 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-heading font-bold flex items-center gap-2 mx-auto tap-active shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reintentar Carga</span>
        </button>
      </div>
    ) : (
      sortedItems.map(item => (
        <ItemProgressCard
          key={item.id || item.sku}
          item={item}
          onManualIncrement={handleManualIncrement}
          onReportarFaltante={handleOpenFaltanteModal}
          isLastScanned={lastScannedSku === item.sku}
        />
      ))
    )}
  </div>

  {/* Botón Flotante de Entrega de Corrección a Mesa en modo ERROR_SEPARACION */ }
  {
    pedido.estado === 'ERROR_SEPARACION' ? (
      <div className="pt-2">
        <button
          type="button"
          onClick={() => (onFinishErrorDelivery ? onFinishErrorDelivery(pedido.mesa_codigo) : onBack())}
          className="w-full py-4 px-6 active:scale-95 text-black font-heading font-black text-sm rounded-2xl shadow-xl flex items-center justify-center gap-2 tap-active bg-amber-500 hover:bg-amber-400 shadow-amber-500/30 animate-pulse"
        >
          <Send className="w-5 h-5" />
          <span>ENTREGAR EN MESA {pedido.mesa_codigo || '301'} (FINALIZAR ERROR)</span>
        </button>
      </div>
    ) : isOrderFinished && (
      <div className="pt-2">
        <button
          onClick={() => onCompletePicking(items)}
          className={`w-full py-4 px-6 active:scale-95 text-white font-heading font-black text-sm rounded-2xl shadow-xl flex items-center justify-center gap-2 tap-active ${totalFaltantes > 0
            ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30'
            : 'bg-[#e60000] hover:bg-[#cc0000] shadow-red-600/30 animate-bounce'
            }`}
        >
          <Send className="w-5 h-5" />
          <span>
            {totalFaltantes > 0
              ? `ENTREGAR CON CIERRE PARCIAL (${totalFaltantes} FALTANTES)`
              : 'ENTREGAR A MESA DE CONTROL'}
          </span>
        </button>
      </div>
    )
  }

  {/* Modal Rápido de Confirmación de Faltante ("No Hay") */ }
  {
    faltanteModalItem && (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in">
        <div className="w-full max-w-sm bg-white border border-zinc-200 rounded-3xl p-5 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-amber-600">
              <PackageX className="w-5 h-5" />
              <h4 className="font-heading font-bold text-zinc-900 text-base">
                Reportar Faltante ("No Hay")
              </h4>
            </div>
            <button
              onClick={() => setFaltanteModalItem(null)}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-3 rounded-2xl bg-zinc-50 border border-zinc-200 mb-4">
            <span className="text-xs font-mono font-bold text-[#e60000] px-1.5 py-0.5 rounded bg-white border border-zinc-200">
              {faltanteModalItem.sku}
            </span>
            <p className="text-sm font-semibold text-zinc-900 mt-1.5 leading-snug">
              {faltanteModalItem.descripcion}
            </p>
            <div className="flex items-center justify-between text-xs text-zinc-500 mt-2 font-mono">
              <span>Ubicación: {faltanteModalItem.ubicacion || 'PAS-01'}</span>
              <span>Faltan: {faltanteModalItem.cantidad_requerida - (faltanteModalItem.cantidad_bipada || 0)} unid.</span>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Motivo / Observación rápida:
            </label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {['Estante vacío', 'No está en pasillo', 'Daño/Incompleto', 'Otro lugar'].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFaltanteMotivo(m)}
                  className={`py-2 px-2.5 rounded-xl text-xs font-mono border transition-all text-left ${faltanteMotivo === m
                    ? 'bg-amber-50 border-amber-500 text-amber-800 font-bold'
                    : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                    }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={faltanteMotivo}
              onChange={e => setFaltanteMotivo(e.target.value)}
              placeholder="Escribe detalle si aplica..."
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-amber-500 font-mono"
            />
          </div>

          <p className="text-[11px] text-zinc-500 mb-4 leading-normal">
            ℹ️ Se consultará el stock en ERP (modo solo lectura). Si hay stock teórico, el supervisor recibirá una alerta de búsqueda física. Tu cronómetro continuará corriendo.
          </p>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setFaltanteModalItem(null)}
              className="flex-1 py-3 px-4 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-mono text-xs font-bold tap-active transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={enviandoFaltante}
              onClick={handleConfirmarFaltante}
              className="flex-1 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-heading font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md shadow-amber-600/30 tap-active disabled:opacity-50"
            >
              {enviandoFaltante ? 'Consultando...' : 'Confirmar Falta'}
            </button>
          </div>
        </div>
      </div>
    )
  }
    </div >
  );
}
