const ENDPOINT_REPORTES = 'https://jsonplaceholder.typicode.com/posts';

function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT_REPORTES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando transacción localmente...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      }).then(() => {
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
          return navigator.serviceWorker.ready
            .then((registro) => {
              console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
              return registro.sync.register('sync-reportes');
            });
        }
      });
    })
    .then(() => {
      return renderizarColaOutbox();
    });
}

function renderizarColaOutbox() {
  const lista = document.getElementById('lista-outbox');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      lista.innerHTML = '';

      if (registros.length === 0) {
        const vacio = document.createElement('li');
        vacio.className = 'vacia';
        vacio.textContent = 'Sin reportes registrados.';
        lista.appendChild(vacio);
        return;
      }

      registros.forEach((registro) => {
        const item = document.createElement('li');

        const datos = document.createElement('div');
        datos.className = 'item-datos';

        const titulo = document.createElement('span');
        titulo.className = 'item-titulo';
        titulo.textContent = registro.titulo;

        const fecha = document.createElement('span');
        fecha.className = 'item-fecha';
        fecha.textContent = formatearFecha(registro.fechaCreacion);

        datos.appendChild(titulo);
        datos.appendChild(fecha);

        const estado = document.createElement('span');
        estado.className = 'estado ' + registro.estado;
        estado.textContent = registro.estado;

        item.appendChild(datos);
        item.appendChild(estado);
        lista.appendChild(item);
      });
    })
    .catch((error) => {
      console.error('[Outbox] No se pudo leer la bandeja:', error);
    });
}

function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT_REPORTES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

function actualizarIndicadorRed() {
  const badge = document.getElementById('badge-red');
  const enLinea = navigator.onLine;

  badge.textContent = enLinea ? 'En Línea' : 'Sin Conexión';
  badge.classList.toggle('online', enLinea);
  badge.classList.toggle('offline', !enLinea);
}

function formatearFecha(timestamp) {
  return new Date(timestamp).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const formIncidencia = document.getElementById('form-incidencia');

formIncidencia.addEventListener('submit', (evento) => {
  evento.preventDefault();

  const datosFormulario = {
    titulo: document.getElementById('titulo').value.trim(),
    descripcion: document.getElementById('descripcion').value.trim()
  };

  procesarEnvioReporte(datosFormulario).then(() => {
    formIncidencia.reset();
  });
});

document.getElementById('btn-purgar').addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(sincronizados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error al purgar la bandeja:', error);
    });
});

window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: solo la UI sincroniza si el navegador no tiene Background Sync (Safari/iOS, Firefox)
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (evento) => {
    if (evento.data && evento.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });

  navigator.serviceWorker.register('./sw.js')
    .catch((error) => {
      console.error('[Outbox] Falló el registro del Service Worker:', error);
    });
}

actualizarIndicadorRed();
renderizarColaOutbox();
