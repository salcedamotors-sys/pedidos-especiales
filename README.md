# Pedidos Salceda

App Android para los pedidos especiales de las 5 sucursales de Salceda Motors.

## Cómo funciona

- Cada colaborador entra con su correo y contraseña (los da de alta el administrador desde la app).
- Al levantar un pedido se toma foto de la nota escrita a mano; el folio se arma solo: `SUCURSAL-PROVEEDOR-NOTA` (ej. `ZAM-VEN-0202`).
- Estatus: Por encargar, En tránsito, Retrasado, No lo hubo, Llegó a sucursal, Entregado al cliente.
- El comprobante PDF (datos + foto de la nota) se comparte directo a WhatsApp.

## Sincronización

Los datos viven en Firebase (proyecto de Google a nombre de Salceda Motors).
Cada celular guarda una copia local: sin señal se puede levantar pedidos y cambiar estatus,
y todo se sube solo cuando regresa el internet. Los cambios de otras sucursales llegan en segundos.

## Dónde descargar la APK

Cada vez que se sube un cambio a este repositorio, GitHub compila la app sola.
La APK queda en **Releases** (columna derecha del repositorio) con el nombre `PedidosSalceda-v1.0.N.apk`.
Las versiones nuevas se instalan encima de la anterior sin perder datos.

## Archivos importantes

- `src/firebase-config.js` — datos del proyecto de Firebase.
- `firestore.rules` — reglas de seguridad; se pegan en Firebase → Firestore → Reglas.
- `firma/` — llave con la que se firma la APK. **No la borres:** sin ella las siguientes versiones no se pueden instalar encima.
