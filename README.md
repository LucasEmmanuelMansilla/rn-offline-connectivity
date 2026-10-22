# offline-connectivity

Librería para que una app React Native distinga una interfaz de red del acceso real a internet. El nombre `offline-connectivity` es el del paquete de trabajo. Esta etapa no publica el paquete.

La app instala las dependencias. Esta librería no incluye módulo nativo ni embebe NetInfo.

## Qué instalar

Siempre:

- `react` `>=18`
- `react-native` `>=0.76`
- `@react-native-community/netinfo` `>=12.0.0`

Solo si la app usa la cola:

- `zustand` `>=5`

Zustand es un peer opcional. `NetworkProvider`, `NetworkConsumer`, `useIsConnected` y `checkInternetConnection` funcionan sin instalarlo.

## Entrada principal

```ts
import {
  NetworkProvider,
  NetworkConsumer,
  useIsConnected,
  checkInternetConnection,
} from 'offline-connectivity';
```

`NetworkProvider` no bloquea el render. Hasta el primer resultado, `useIsConnected` y `NetworkConsumer` reciben `null`.

Valores por defecto del ping:

| Opción | Valor |
| --- | --- |
| `pingServerUrl` | `https://www.google.com/` |
| `pingTimeout` | `10000` |
| `httpMethod` | `HEAD` |
| `shouldPing` | `true` |
| `pingInterval` | `0` |
| `pingOnlyIfOffline` | `false` |
| `pingInBackground` | `false` |
| `customHeaders` | `{}` |

Los métodos admitidos son `HEAD` y `OPTIONS`. Con ping activo, HTTP 2xx y 3xx cuentan como acceso. Un 4xx, un 5xx, un error de red o el timeout cuentan como sin acceso. Sin interfaz de red no se hace la petición. `checkInternetConnection` usa los mismos valores por defecto y resuelve `false` si no hay interfaz o si NetInfo no puede completar la lectura.

## Entrada Zustand

```ts
import {
  useNetworkStore,
  enqueue,
  dismiss,
  pauseQueue,
  resumeQueue,
} from 'offline-connectivity/zustand';
```

`useNetworkStore` devuelve `isConnected` y `pendingKeys`. La cola vive solo en memoria: al terminar el proceso queda vacía. Entre el inicio de un trabajo y el del siguiente pasan 50 ms, y esa espera no se puede cambiar.

El provider y el store no comparten suscripción. Cada uno aplica las mismas reglas con su propio monitor. El store usa siempre la configuración por defecto. Cambiar el servidor en `NetworkProvider` no cambia el store.

## Permiso en Android

La app Android declara el permiso de estado de red. Esta librería no lo solicita ni muestra un diálogo:

```xml
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

Si ese permiso falta o se revoca y NetInfo no puede completar la lectura, el estado del provider y del store queda en `null`. No se informa acceso ni sin acceso.
