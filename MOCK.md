# Rama `mock`: front sin backend

Esta rama es para probar cambios de front rápido. **Nunca va a prod.** No hay backend: todo lo que el
`HttpClient` manda a `apiUrl` lo responde `MockBackend`, en el navegador, contra una base guardada en
localStorage.

## Arrancar

```bash
pnpm install
pnpm start
```

Entrá a `http://localhost:4200` con **cualquier usuario y contraseña**. El usuario de la sesión es el
sysadmin grabado de staging, con todos los permisos.

## Cómo funciona

Todo vive en `src/app/mock/`:

| Archivo | Qué hace |
| --- | --- |
| `mock-backend.ts` | Reemplaza el `HttpBackend` de Angular (registrado en `app.config.ts`). Resuelve cada request en este orden: handlers con reglas → ABM genérico → respuesta grabada de staging → 501. |
| `mock-crud.ts` | ABM genérico para cualquier recurso con `/paginate`, `/save`, `/uuid/{id}` y `DELETE /{id}`. También reproduce lo grabado (misma ruta, otra query u otro uuid). |
| `mock-paginate.ts` | Interpreta el `PaginateQuery` del Core (filtros AND/OR, orden, página en base 1) sobre arrays en memoria. |
| `mock-handlers.ts` | Endpoints con lógica: login, catálogo agrupado, lectura por código de barras, `order/commit` y `convert` (mueven stock), apertura de caja, categorías (árbol), alta de terceros (`onboard`), configuración y ajuste de stock. |
| `mock-db.ts` | La base: colecciones, detalles y respuestas grabadas, persistida en localStorage (`ventosky.mock.db`). |
| `fixtures/staging-dump.json` | La semilla: 334 respuestas reales de staging (sin contraseñas). |

Además:

- `environment*.ts` quedaron iguales: `apiUrl: '/mock-api'` (nunca sale a la red) y los feature
  flags prendidos.
- Se sacó `authErrorInterceptor`: no hay tokens que vencer.

## Perillas (en la URL de la app)

- `?mockReset`: borra la base del navegador y vuelve a sembrar desde el dump.
- `?mockError=409` (o 400, 500…): hace fallar todo lo que no sea GET con ese status, para probar
  toasts y diálogos de error.
- `?mockLatency=0`: saca la demora artificial (por defecto, entre 120 y 380 ms).

## Qué esperar

- Las pantallas que listan, filtran, crean, editan y borran funcionan contra la base local.
- Una acción que el mock no conoce (POST, PUT o DELETE) responde OK con lo mismo que se mandó y deja
  un `console.warn` que empieza con `[mock]`. Un GET sin datos responde 501, con el mismo aviso.
- Lo que el backend calcula y el front solo muestra (numeración, morosidad, imputaciones de cuenta
  corriente, promociones en el total guardado) está simplificado o sale de lo grabado.
- Si falta algo, buscá `[mock]` en la consola y agregá una ruta en `mock-handlers.ts`.
