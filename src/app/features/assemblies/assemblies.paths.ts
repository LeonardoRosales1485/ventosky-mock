/**
 * El área `/panel/assemblies`: el listado y las tres pantallas que cuelgan de él.
 *
 * Sigue la convención del proyecto —plural para el listado, la acción nombrada para el alta— y la
 * misma forma que los traslados: el alta vive **adentro** del área, porque consultar y armar los
 * abre el mismo `assembly.view` de base y lo que separa a las pantallas es `assembly.create`, que
 * el botón «Nuevo armado» valida por su cuenta.
 */
export const ASSEMBLIES_PATH = '/panel/assemblies';

/** Registrar un armado: consume los componentes e ingresa el terminado, en una sola operación. */
export const NEW_ASSEMBLY_PATH = `${ASSEMBLIES_PATH}/new`;

/**
 * Romper unidades armadas y recuperar sus componentes.
 *
 * **Es una pantalla aparte y no un botón de la fila del listado**, y eso no es una decisión de
 * navegación: desarmar no revierte un documento —las unidades que se rompen pueden venir de dos
 * armados distintos—, así que colgarla de una fila diría lo contrario de lo que hace (§6.9).
 */
export const DISASSEMBLE_PATH = `${ASSEMBLIES_PATH}/disassemble`;

/** La pantalla del recall: del lote de un componente a los clientes, y el camino inverso. */
export const ASSEMBLY_TRACEABILITY_PATH = `${ASSEMBLIES_PATH}/traceability`;
