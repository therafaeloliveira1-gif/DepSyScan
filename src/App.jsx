import React, { useState, useEffect } from 'react';
import OperatorSelector from './components/OperatorSelector';
import OrderQueue from './components/OrderQueue';
import PickingScanner from './components/PickingScanner';
import TableDeliveryModal from './components/TableDeliveryModal';
import GlobalPauseOverlay from './components/GlobalPauseOverlay';
import MobileUpdateModal from './components/MobileUpdateModal';
import { checkForPickingUpdate } from './services/updaterService';
import { fetchStatus, fetchNotas, fetchPedidoReal } from './services/api';
import { playBeepError, playOrderCompleted } from './services/audioService';

export default function App() {
  const [isGlobalPaused, setIsGlobalPaused] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);

  // Verificación de actualización para colectores (al inicio tras 4 seg)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const info = await checkForPickingUpdate();
        if (info && info.available) {
          setUpdateInfo(info);
        }
      } catch (e) {
        console.warn('Error verificando actualización:', e);
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // Polling ágil (cada 2.5s) para detectar la Pausa Maestra del depósito activada por el supervisor
  useEffect(() => {
    let isMounted = true;
    async function checkStatus() {
      try {
        const res = await fetchStatus();
        if (isMounted && res && res.success) {
          const paused = Boolean(res.pausaGlobalActiva ?? res.pausaGlobal ?? res.isPaused);
          setIsGlobalPaused(paused);
        }
      } catch (err) {
        console.warn('Error verificando estado de pausa en App:', err);
      }
    }

    checkStatus();
    const interval = setInterval(checkStatus, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const [operario, setOperario] = useState(() => {
    try {
      const saved = localStorage.getItem('depsys_operario') || localStorage.getItem('depsystem_operario');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [activePedido, setActivePedido] = useState(() => {
    try {
      const saved = localStorage.getItem('depsys_active_pedido') || localStorage.getItem('depsystem_active_pedido');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Estado para la nota que estaba siendo separada y fue pausada por una emergencia de mesa
  const [pausedPedido, setPausedPedido] = useState(() => {
    try {
      const saved = localStorage.getItem(`depsys_paused_pedido_${operario?.id}`);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

  function handleSelectOperator(op) {
    setOperario(op);
    try {
      localStorage.setItem('depsys_operario', JSON.stringify(op));
      localStorage.setItem('depsystem_operario', JSON.stringify(op));
    } catch (e) {
      console.warn('Could not save operator to localStorage:', e);
    }
  }

  function handleChangeOperator() {
    if (operario?.id) {
      localStorage.removeItem(`depsys_session_start_${operario.id}`);
      localStorage.removeItem(`depsys_idle_start_${operario.id}`);
      localStorage.removeItem(`depsys_paused_pedido_${operario.id}`);
    }
    setOperario(null);
    setPausedPedido(null);
    localStorage.removeItem('depsys_operario');
    localStorage.removeItem('depsystem_operario');
    localStorage.removeItem('depsys_active_pedido');
    localStorage.removeItem('depsystem_active_pedido');
    setActivePedido(null);
  }

  function handleStartPicking(pedidoNormalizado) {
    if (operario?.id) {
      localStorage.removeItem(`depsys_idle_start_${operario.id}`);
    }
    setActivePedido(pedidoNormalizado);
    try {
      localStorage.setItem('depsys_active_pedido', JSON.stringify(pedidoNormalizado));
      localStorage.setItem('depsystem_active_pedido', JSON.stringify(pedidoNormalizado));
    } catch (e) {
      console.warn('Could not save active pedido:', e);
    }
  }

  // Restaurar automáticamente la nota que fue pausada para atender la emergencia de mesa
  function restaurarNotaPausada() {
    const key = `depsys_paused_pedido_${operario?.id}`;
    let saved = pausedPedido;
    if (!saved && operario?.id) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) saved = JSON.parse(raw);
      } catch (_) {}
    }

    if (saved) {
      console.log(`[EMERGENCIA] Reanudando nota previa pausada #${saved.num_pedido}`);
      setActivePedido(saved);
      setPausedPedido(null);
      if (operario?.id) {
        localStorage.removeItem(key);
      }
      try {
        localStorage.setItem('depsys_active_pedido', JSON.stringify(saved));
        localStorage.setItem('depsystem_active_pedido', JSON.stringify(saved));
      } catch (_) {}
      playOrderCompleted();
    } else {
      if (operario?.id) {
        localStorage.setItem(`depsys_idle_start_${operario.id}`, String(Date.now()));
      }
      setActivePedido(null);
      localStorage.removeItem('depsys_active_pedido');
      localStorage.removeItem('depsystem_active_pedido');
    }
  }

  function handleFinishErrorDelivery(mesaCod) {
    setShowDeliveryModal(false);
    restaurarNotaPausada();
  }

  function handleCompletePicking() {
    setShowDeliveryModal(true);
  }

  function handleDeliverySuccess() {
    if (operario?.id) {
      localStorage.setItem(`depsys_idle_start_${operario.id}`, String(Date.now()));
    }
    setShowDeliveryModal(false);
    setActivePedido(null);
    localStorage.removeItem('depsys_active_pedido');
    localStorage.removeItem('depsystem_active_pedido');
  }

  // Interceptor en vivo de Notas de Emergencia (devueltas por Mesa con ERROR_SEPARACION)
  useEffect(() => {
    if (!operario?.id) return;
    let isMounted = true;

    async function checkEmergenciaMesa() {
      try {
        const res = await fetchNotas();
        if (!isMounted || !res?.success || !Array.isArray(res.notas)) return;

        // Buscar si existe una nota en ERROR_SEPARACION asignada a este separador
        const emergencyNota = res.notas.find(n => {
          const matchId = n.separador_id && String(n.separador_id) === String(operario.id);
          const matchNombre = n.separador_nombre && operario.nombre &&
            n.separador_nombre.trim().toUpperCase() === operario.nombre.trim().toUpperCase();
          return (matchId || matchNombre) && n.estado === 'ERROR_SEPARACION';
        });

        if (emergencyNota) {
          // Si ya estamos mostrando esta misma nota de emergencia en pantalla, no hacer nada
          if (activePedido && (String(activePedido.num_pedido) === String(emergencyNota.num_pedido) || String(activePedido.id) === String(emergencyNota.id))) {
            return;
          }

          // Si el separador estaba separando otra nota normal, pausarla inmediatamente
          if (activePedido && activePedido.estado !== 'ERROR_SEPARACION') {
            console.warn(`[EMERGENCIA] Pausando Nota #${activePedido.num_pedido} para atender Nota devuelta #${emergencyNota.num_pedido}`);
            setPausedPedido(activePedido);
            try {
              localStorage.setItem(`depsys_paused_pedido_${operario.id}`, JSON.stringify(activePedido));
            } catch (_) {}
            playBeepError();
          }

          // Cargar datos completos de la nota devuelta con error y convertirla en la activa
          const detRes = await fetchPedidoReal(emergencyNota.num_pedido);
          const emergPedidoCompleto = (detRes.success && detRes.pedido) ? {
            ...emergencyNota,
            ...detRes.pedido,
            items: detRes.pedido.items || emergencyNota.items || [],
            estado: 'ERROR_SEPARACION'
          } : emergencyNota;

          setActivePedido(emergPedidoCompleto);
          try {
            localStorage.setItem('depsys_active_pedido', JSON.stringify(emergPedidoCompleto));
            localStorage.setItem('depsystem_active_pedido', JSON.stringify(emergPedidoCompleto));
          } catch (_) {}
        } else {
          // Si NO hay ninguna nota en ERROR_SEPARACION para este separador,
          // pero el activePedido actual está en ERROR_SEPARACION, significa que la Mesa
          // ya confirmó la corrección o se resolvió el error.
          if (activePedido && activePedido.estado === 'ERROR_SEPARACION') {
            console.log('[EMERGENCIA] Nota de error resuelta en mesa. Reanudando nota pausada...');
            restaurarNotaPausada();
          }
        }
      } catch (err) {
        console.warn('Error verificando notas de emergencia:', err);
      }
    }

    checkEmergenciaMesa();
    const interval = setInterval(checkEmergenciaMesa, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [operario, activePedido, pausedPedido]);

  return (
    <main className="w-full min-h-[100dvh] h-[100dvh] flex flex-col overflow-hidden font-sans bg-[#f8fafc] text-zinc-900">
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {/* Overlay de Pausa Global Maestra del Depósito */}
        <GlobalPauseOverlay isPaused={isGlobalPaused} />

        {/* Flujo de Pantallas */}
        {!operario ? (
          <OperatorSelector
            onSelectOperator={handleSelectOperator}
            currentOperator={operario}
          />
        ) : !activePedido ? (
          <OrderQueue
            operario={operario}
            onStartPicking={handleStartPicking}
            onChangeOperator={handleChangeOperator}
            isGlobalPaused={isGlobalPaused}
          />
        ) : (
          <PickingScanner
            pedido={activePedido}
            operario={operario}
            onCompletePicking={handleCompletePicking}
            onFinishErrorDelivery={handleFinishErrorDelivery}
            pausedPedido={pausedPedido}
            isGlobalPaused={isGlobalPaused}
          />
        )}
      </div>

      {/* Dock / Barra de soporte de navegación Android (Motos Mendes Titanium) */}
      <footer 
        className="w-full bg-[#09090b] border-t border-zinc-800/80 flex items-center justify-center shrink-0 z-40 transition-all select-none"
        style={{
          minHeight: 'max(env(safe-area-inset-bottom, 0px), 14px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}
      >
        <div className="w-12 h-1 bg-zinc-700/60 rounded-full my-1"></div>
      </footer>

      {/* Modal de Entrega a Mesa al Finalizar el Picking */}
      {showDeliveryModal && activePedido && (
        <TableDeliveryModal
          pedido={activePedido}
          operario={operario}
          onClose={() => setShowDeliveryModal(false)}
          onDeliverySuccess={handleDeliverySuccess}
        />
      )}

      {/* Modal de Actualización de APK para Colectores */}
      {updateInfo && (
        <MobileUpdateModal
          updateInfo={updateInfo}
          onClose={() => setUpdateInfo(null)}
        />
      )}
    </main>
  );
}
