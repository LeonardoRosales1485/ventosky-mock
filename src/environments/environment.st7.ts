/**
 * Rama `mock`: no hay backend. `apiUrl` es un prefijo que nunca sale a la red: todo lo que empieza
 * con él lo responde `MockBackend` (src/app/mock) en el navegador.
 */
export const environment = {
  apiUrl: '/mock-api',
  paginateSqlDialect: 'postgresql' as const,
  /** En el mock, todo prendido: se ven todas las puertas de entrada. */
  features: {
    batchTracking: true,
    serialTracking: true,
    productModels: true,
  },
};
