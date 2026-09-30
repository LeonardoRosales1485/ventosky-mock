import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, defer, delay, map, of, throwError } from 'rxjs';
import { CashRegisterEntryContextDto } from '../../../core/cash-session/cash-session.model';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import {
  AdjustmentRequest,
  AdjustmentResultDto,
  AllocateRequest,
  AllocationInput,
  AllocationPreviewDto,
  AllocationTraceDto,
  CheckingAccountCreditDto,
  CheckingAccountCreditRowDto,
  CheckingAccountDebtDto,
  CheckingAccountDebtRowDto,
  CheckingAccountRowDto,
  CheckingAccountsSummaryDto,
  ConsistencyDiscrepancyDto,
  ConsistencyReportDto,
  CreditState,
  DebtExtensionRowDto,
  ExtendDebtRequest,
  LedgerQuery,
  NoticeDto,
  NoticePreviewDto,
  CheckingAccountAllocationRowDto,
  PaymentMethodOption,
  PreviewAllocationRequest,
  ReassignRequest,
  RegisterCreditRequest,
  ReverseRequest,
  ReversePreviewDto,
  SaveAccountRequest,
  SendNoticeRequest,
  StatementEntryRowDto,
  VoidCreditRequest,
  VoidPreviewDto,
} from './checking-account.model';
import {
  CheckingAccountPolicyDto,
  DelinquencyEventDto,
  PolicyPreviewDto,
  SaveAccountPolicyRequest,
  SaveCompanyPolicyRequest,
  SetDelinquencyRequest,
} from './checking-account-policy.model';
import { CheckingAccountsMockDb, MockApiError } from './checking-accounts-mock.db';

/**
 * La API del módulo, **a medio migrar**: `paginateAccounts` y los tres de política ya pegan contra
 * el backend, y el resto sigue en memoria a la espera de los endpoints de cobros e imputación.
 *
 * La mezcla es deliberada y no incómoda, porque la firma nunca dependió del almacén: cada método
 * corresponde a un endpoint de la tabla de §15 y respeta su forma, así que reemplazar un cuerpo por
 * su `http.post(...)` no toca ni las pantallas ni los modelos. Lo que sí cambia al migrar uno es su
 * **tipo de retorno**, que pasa a ser el DTO real —más chico que el del mock mientras el backend no
 * tenga políticas ni morosidad—, y ahí es donde la pantalla se entera de qué puede mostrar.
 *
 * Cada método corresponde a un endpoint de la tabla de §15 y respeta su forma: los listados reciben
 * el mismo `PaginateQuery` que arma `MatTablePaginator` y devuelven el `Page<T>` de Spring, las
 * escrituras devuelven lo que crearon, y todo llega por un `Observable` con latencia simulada, así
 * que las pantallas manejan estados de carga y de error de verdad y no ven una respuesta síncrona
 * que después no van a tener.
 *
 * Por eso la firma no expone nada del almacén en memoria —{@link CheckingAccountsMockDb}— más allá
 * de sus DTOs.
 */

/** Latencia simulada, en milisegundos. Suficiente para ver el spinner, no para molestar. */
const READ_LATENCY_MS = 260;
const WRITE_LATENCY_MS = 480;

@Service()
export class CheckingAccountsApiService {
  private readonly http = inject(HttpClient);
  private readonly db = inject(CheckingAccountsMockDb);

  /* ─────────────────────────────────  Política  ───────────────────────────────── */

  /**
   * La política de cuenta corriente de la empresa.
   *
   * **Nunca da 404**: sin política cargada el backend devuelve los defaults de plataforma con
   * `uuid: null` y las tres fuentes en `DEFAULT`. Por eso la pantalla no replica esos valores — el
   * día que cambien, cambian de un solo lado.
   */
  getCompanyPolicy(): Observable<CheckingAccountPolicyDto> {
    return this.http.get<CheckingAccountPolicyDto>(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY));
  }

  /**
   * Guarda la política de la empresa.
   *
   * Es un **upsert por nivel** —hay a lo sumo una por empresa—, así que el cuerpo no lleva `uuid`.
   * Si con esto la empresa pasó de `MANUAL` a `AUTOMATIC`, la respuesta trae `reprocess` con lo que
   * el backend imputó.
   */
  saveCompanyPolicy(request: SaveCompanyPolicyRequest): Observable<CheckingAccountPolicyDto> {
    return this.http.post<CheckingAccountPolicyDto>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY_SAVE),
      request,
    );
  }

  /**
   * Qué pasaría si se guardara esa política. **No escribe nada.**
   *
   * El `accountsOverLimit` y los números del reproceso los calcula el backend con las mismas
   * funciones que después ejecutan el cambio: si la pantalla los estimara por su cuenta, el día que
   * cambie una regla habría dos versiones de la verdad.
   */
  previewCompanyPolicy(request: SaveCompanyPolicyRequest): Observable<PolicyPreviewDto> {
    return this.http.post<PolicyPreviewDto>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY_PREVIEW),
      request,
    );
  }

  /**
   * El override de política de un titular.
   *
   * **Sin override cargado devuelve los tres parámetros en `INHERIT`** —que es exactamente lo que
   * significa no tener uno— y el `resolved` ya con lo que le rige. La pantalla necesita las dos
   * cosas juntas: qué decidió este titular y qué termina rigiendo.
   */
  getAccountPolicy(accountUuid: string): Observable<CheckingAccountPolicyDto> {
    return this.http.get<CheckingAccountPolicyDto>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${accountUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.ACCOUNT_POLICY_SUFFIX,
      ),
    );
  }

  /**
   * Guarda el override del titular.
   *
   * **Pasar un parámetro a `INHERIT` es la forma de sacarlo**: la fila queda pero deja de decidir, y
   * ese parámetro vuelve a lo que diga la empresa. No hay un borrado aparte — dos caminos para lo
   * mismo dejarían uno sin usar.
   *
   * No toca las deudas ya emitidas: su vencimiento se resolvió al emitirlas.
   */
  saveAccountPolicy(
    accountUuid: string,
    request: SaveAccountPolicyRequest,
  ): Observable<CheckingAccountPolicyDto> {
    return this.http.post<CheckingAccountPolicyDto>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${accountUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.ACCOUNT_POLICY_SUFFIX,
      ),
      request,
    );
  }

  /**
   * Fija el nivel de morosidad: graba el evento y actualiza el nivel de la cuenta, en la misma
   * transacción del backend.
   *
   * El motivo es obligatorio. `previousLevel` **no se manda**: lo resuelve el backend leyendo lo que
   * la cuenta tenía — que lo mandara el cliente permitiría escribir una historia que no ocurrió.
   */
  setDelinquency(
    accountUuid: string,
    request: SetDelinquencyRequest,
  ): Observable<DelinquencyEventDto> {
    return this.http.post<DelinquencyEventDto>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${accountUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.DELINQUENCY_SUFFIX,
      ),
      request,
    );
  }

  /**
   * El historial de morosidad, del más nuevo al más viejo.
   *
   * Contesta la pregunta que la auditoría genérica no puede: «¿desde cuándo esta cuenta está en
   * estudio jurídico, y quién lo decidió?». Se hace años después.
   */
  delinquencyHistory(accountUuid: string): Observable<DelinquencyEventDto[]> {
    return this.http.get<DelinquencyEventDto[]>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${accountUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.DELINQUENCY_SUFFIX,
      ),
    );
  }

  /* ────────────────────────────────  Aviso de deuda  ───────────────────────────────── */

  /**
   * El aviso propuesto: a quién iría, con qué texto y con qué detalle de deuda vencida.
   *
   * No manda ni registra nada, así que se puede pedir tantas veces como haga falta. Es el paso que
   * hace a la funcionalidad: el sistema arma el detalle y la persona decide si eso es lo que
   * corresponde decirle a este cliente hoy.
   */
  previewNotice(accountUuid: string): Observable<NoticePreviewDto> {
    return this.http.post<NoticePreviewDto>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${accountUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.NOTICE_SUFFIX +
          API_ENDPOINTS.CHECKING_ACCOUNTS.PREVIEW_SUFFIX,
      ),
      {},
    );
  }

  /**
   * Manda el aviso —con el texto que quedó, editado o no— y lo registra.
   *
   * **Siempre a pedido de una persona.** No hay avisos automáticos: ningún proceso agendado le
   * escribe a un cliente, porque el sistema no sabe si esa deuda está en discusión o si el caso ya
   * está en un estudio jurídico.
   */
  sendNotice(accountUuid: string, request: SendNoticeRequest): Observable<NoticeDto> {
    return this.http.post<NoticeDto>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${accountUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.NOTICE_SUFFIX,
      ),
      request,
    );
  }

  /**
   * Recalcula los caches de una cuenta: el saldo desde las partidas y el nivel desde el último
   * evento.
   *
   * **Es la contraparte del job de consistencia**, que detecta y no corrige: una diferencia
   * significa que hay un bug en algún camino de escritura, y arreglarla sola lo escondería. Alguien
   * tiene que poder decidir que sí, y esto es ese botón.
   */
  recalculateAccount(accountUuid: string): Observable<ConsistencyReportDto> {
    return this.http.post<ConsistencyReportDto>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${accountUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.RECALCULATE_SUFFIX,
      ),
      {},
    );
  }

  /**
   * Corre la verificación sobre **todas** las cuentas activas de la empresa.
   *
   * Detecta y no corrige: deja una fila por diferencia y sella la fecha aunque no encuentre ninguna.
   * Por eso la respuesta trae `accountsChecked` además de `discrepancies` — «no encontré nada» y «no
   * miré nada» se leen igual sin ese número.
   */
  runConsistency(): Observable<ConsistencyReportDto> {
    return this.http.post<ConsistencyReportDto>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CONSISTENCY_RUN),
      {},
    );
  }

  /** El listado de lo que las verificaciones encontraron, revisadas incluidas. */
  paginateDiscrepancies(
    query: PaginateQuery,
  ): Observable<PaginationData<ConsistencyDiscrepancyDto>> {
    return this.http.post<PaginationData<ConsistencyDiscrepancyDto>>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.DISCREPANCY_PAGINATE),
      query,
    );
  }

  /* ────────────────────────────────  Correcciones  ───────────────────────────────── */

  /**
   * Ajuste manual del saldo: una partida `ADJUSTMENT`, deudora o acreedora, con motivo obligatorio.
   *
   * **No es un `balance += x`.** El backend emite una partida de verdad —con su vencimiento, si es en
   * contra— y el saldo sale de recalcularlas: por eso la respuesta trae el saldo resultante y la
   * pantalla no lo proyecta por su cuenta.
   */
  adjust(request: AdjustmentRequest): Observable<AdjustmentResultDto> {
    return this.http.post<AdjustmentResultDto>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ADJUSTMENT),
      request,
    );
  }

  /**
   * Prorroga el vencimiento de una deuda y devuelve la deuda con su fecha nueva.
   *
   * `dateDueOriginal` **no** se mueve: es lo que después distingue «vencía más tarde» de «venció y se
   * le corrió», y es la razón de que la prórroga sea una operación y no la edición de un campo.
   */
  extendDebt(debtUuid: string, request: ExtendDebtRequest): Observable<CheckingAccountDebtDto> {
    return this.http.post<CheckingAccountDebtDto>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBT}/${debtUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.EXTEND_SUFFIX,
      ),
      request,
    );
  }

  /* ─────────────────────────────────  Lecturas  ───────────────────────────────── */

  /**
   * `POST /checking-account/paginate` — **el primero que dejó de ser mock.**
   *
   * El cuerpo es el mismo `PaginateQuery` que arma `MatTablePaginator`; lo único que hay que saber es
   * que cuatro de sus columnas no existen en `checking_accounts` y las traduce el backend:
   * `name` y `docNumber` viven en `parties`, `role` en `party_roles`, y `hasOverdue` se resuelve
   * contra los vencimientos del día. Filtrar, buscar y ordenar por ellas es pedirlas por su nombre;
   * la pantalla no sabe —ni tiene por qué— dónde están.
   *
   * `overdueAmount` **no** se puede ordenar: el backend lo calcula después de la consulta, así que un
   * orden por esa columna valdría sólo dentro de la página. Por eso la tabla no ofrece ese
   * encabezado.
   */
  paginateAccounts(query: PaginateQuery): Observable<PaginationData<CheckingAccountRowDto>> {
    return this.http.post<PaginationData<CheckingAccountRowDto>>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.PAGINATE),
      query,
    );
  }

  /**
   * `GET /checking-account/uuid/{uuid}` — el heredado del Core, no un path propio.
   *
   * El análisis nombra `GET /checking-account/{uuid}`, pero el ABM automático ya expone la ficha en
   * `uuid/{uuid}` y un segundo path chocaría además con `party-role/{uuid}`.
   */
  getAccount(uuid: string): Observable<CheckingAccountRowDto> {
    return this.http.get<CheckingAccountRowDto>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.BY_UUID}/${uuid}`),
    );
  }

  /**
   * Prende o apaga la cuenta. **Es lo único que el `save` de la cuenta edita**: el alta la hace el
   * alta del rol, así que un guardado sin `uuid` responde 400.
   *
   * Apagada, el medio «cuenta corriente» deja de ofrecerse en el mostrador — es el único freno que
   * el módulo tiene sobre un titular puntual, porque el nivel de morosidad no bloquea nada.
   */
  setAccountEnabled(request: SaveAccountRequest): Observable<CheckingAccountRowDto> {
    return this.http.post<CheckingAccountRowDto>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.SAVE),
      request,
    );
  }

  /**
   * `POST /checking-account/{uuid}/statement`.
   *
   * El cuerpo **no** es el `PaginateList` del resto de los listados: el extracto une dos tablas, así
   * que no hay una tabla sobre la que armar un `WHERE` y el endpoint sólo acepta página. Por eso la
   * tabla del extracto no ofrece encabezados ordenables — prometerlos sería ofrecer un orden que el
   * backend ignora.
   */
  paginateStatement(
    accountUuid: string,
    query: PaginateQuery,
    includeVoided = true,
  ): Observable<PaginationData<StatementEntryRowDto>> {
    return this.http.post<PaginationData<StatementEntryRowDto>>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${accountUuid}/statement`),
      { page: query.page, size: query.size, includeVoided } satisfies LedgerQuery,
    );
  }

  /**
   * `POST /checking-account/{uuid}/debts`.
   *
   * Sin `states` el backend devuelve las **abiertas** —`PENDIENTE`, `PARCIAL` y `VENCIDA`—, que es
   * lo que esta pestaña muestra: lo pagado y lo anulado ya no es deuda.
   */
  paginateDebts(
    accountUuid: string,
    query: PaginateQuery,
    states?: readonly string[],
  ): Observable<PaginationData<CheckingAccountDebtRowDto>> {
    return this.http.post<PaginationData<CheckingAccountDebtRowDto>>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBTS}/${accountUuid}/debts`),
      // Sin `states` el backend devuelve las abiertas, que es el default de la pestaña: pagada y
      // anulada ya no son deuda, y arrancar mostrándolas escondería lo único que hay que mirar.
      { page: query.page, size: query.size, ...(states?.length ? { states } : {}) },
    );
  }

  /**
   * Los cobros de una cuenta, filtrados por en qué terminó su plata.
   *
   * Es el mismo `POST /checking-account/credit/paginate` con pseudo-filtros que traduce el backend:
   * `accountUuid` vive en `checking_accounts`, y tanto `state` como `onlyUnallocated` se resuelven
   * por ids —el estado es un `CASE` sobre tres columnas, y la bandeja necesita además excluir los
   * anulados, que con `IS NULL` no se expresa en el modelo de filtros del Core—.
   *
   * Los estados viajan **separados por coma en un solo filtro**, no uno por estado: el backend los
   * resuelve con un `IN` sobre el `CASE` que deriva el estado, así que pedir dos cuesta lo mismo que
   * pedir uno. Sin ninguno, todos.
   *
   * No hace falta mandar el orden: el backend ordena por fecha de emisión descendente y desempata por
   * id, así que el listado abre por lo último que entró y dos llamadas iguales devuelven lo mismo.
   */
  paginateAccountCredits(
    accountUuid: string,
    query: PaginateQuery,
    states?: readonly CreditState[],
  ): Observable<PaginationData<CheckingAccountCreditRowDto>> {
    const stateFilter = states?.length
      ? [{ tabla: 't', columna: 'state', operacion: '=', valor: states.join(',') }]
      : [];
    return this.http.post<PaginationData<CheckingAccountCreditRowDto>>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE),
      {
        ...query,
        filtros: [
          ...(query.filtros ?? []),
          [{ tabla: 't', columna: 'accountUuid', operacion: '=', valor: accountUuid }],
          ...(stateFilter.length ? [stateFilter] : []),
        ],
      },
    );
  }

  /**
   * Las prórrogas de una deuda, de la más nueva a la más vieja.
   *
   * `debtUuid` no es una columna de `checking_account_debt_extensions` —ahí hay un id interno— y la
   * traduce el backend a un `JOIN` contra la deuda, igual que en el libro de imputaciones. El orden
   * también lo pone el backend: el Core no agrega ninguno cuando nadie lo pide.
   */
  paginateDebtExtensions(debtUuid: string): Observable<PaginationData<DebtExtensionRowDto>> {
    return this.http.post<PaginationData<DebtExtensionRowDto>>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.DEBT_EXTENSION_PAGINATE),
      {
        page: 1,
        size: 50,
        filtros: [[{ tabla: 't', columna: 'debtUuid', operacion: '=', valor: debtUuid }]],
      },
    );
  }

  /**
   * La línea de tiempo de una deuda: sus imputaciones y las reversiones que las deshicieron, en
   * orden cronológico.
   *
   * `debtUuid` no es una columna de `checking_account_allocations` —ahí hay un id interno— y la
   * traduce el backend. Se pide en orden ascendente por fecha porque la pregunta que contesta es
   * «cómo llegó esta deuda a su pendiente», y eso se lee hacia adelante.
   */
  paginateDebtTimeline(
    debtUuid: string,
    query: PaginateQuery,
  ): Observable<PaginationData<CheckingAccountAllocationRowDto>> {
    return this.paginateAllocationsOf('debtUuid', debtUuid, query);
  }

  /**
   * Las imputaciones de un **cobro**: a qué deudas se aplicó y por cuánto.
   *
   * Es la misma pregunta de la línea de tiempo mirada desde el otro lado, y el mismo endpoint: el
   * backend traduce tanto `debtUuid` como `creditUuid` a un `JOIN` contra la tabla de la partida, y
   * sólo agrega la relación cuando el filtro está.
   */
  paginateCreditAllocations(
    creditUuid: string,
    query: PaginateQuery,
  ): Observable<PaginationData<CheckingAccountAllocationRowDto>> {
    return this.paginateAllocationsOf('creditUuid', creditUuid, query);
  }

  /**
   * El paginado de imputaciones acotado a una partida.
   *
   * **El orden va por el nombre de la columna y con `direccion`.** El paginado del Core arma SQL
   * nativo concatenando `tabla.columna direccion`, así que el nombre de la propiedad Java y el campo
   * `orden` producían `ORDER BY t.dateCreated null`: Postgres rechazaba la consulta y el diálogo
   * mostraba la lista vacía.
   */
  private paginateAllocationsOf(
    column: 'debtUuid' | 'creditUuid',
    uuid: string,
    query: PaginateQuery,
  ): Observable<PaginationData<CheckingAccountAllocationRowDto>> {
    return this.http.post<PaginationData<CheckingAccountAllocationRowDto>>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION_PAGINATE),
      {
        ...query,
        filtros: [
          ...(query.filtros ?? []),
          [{ tabla: 't', columna: column, operacion: '=', valor: uuid }],
        ],
        ordenes: [{ tabla: 't', columna: 'date_created', direccion: 'ASC' }],
      },
    );
  }

  /**
   * `POST /checking-account/credit/paginate` — cobros y pagos de toda la empresa.
   *
   * Tres de sus columnas no están en `checking_account_credits` y las traduce el backend:
   * `partyName` vive en `parties`, `role` en `party_roles`, y `state` es un `CASE` sobre tres
   * columnas que se resuelve por ids. Filtrar y ordenar por ellas es pedirlas por su nombre.
   *
   * `state` **no** se puede ordenar: se resuelve como un `IN` de ids, no como una columna. Por eso la
   * tabla no ofrece ese encabezado.
   */
  paginateCollections(
    query: PaginateQuery,
  ): Observable<PaginationData<CheckingAccountCreditRowDto>> {
    return this.http.post<PaginationData<CheckingAccountCreditRowDto>>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE),
      query,
    );
  }

  /**
   * `GET /checking-account/credit/uuid/{uuid}` — la ficha de un cobro, con **todas** sus filas.
   *
   * A diferencia del paginado, la lectura por uuid trae los medios y las imputaciones: son dos
   * consultas por cobro, que en un listado serían un N+1 por página y acá son una sola. Es lo que
   * contesta «qué hizo todo este cobro» sin recursión — todas las filas de un crédito llevan su
   * `id_credit`, así que la historia completa es un filtro plano.
   */
  getCredit(uuid: string): Observable<CheckingAccountCreditRowDto> {
    return this.http.get<CheckingAccountCreditRowDto>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT}/uuid/${uuid}`),
    );
  }

  /** Las tres tarjetas del encabezado del listado. */
  summary(): Observable<CheckingAccountsSummaryDto> {
    return this.read(() => this.db.summary());
  }

  /**
   * `GET /cash-register/entry-context` — a qué caja entra este usuario y si ya tiene sesión abierta.
   *
   * Lo pide el propio módulo y no el servicio de ventas: cuentas corrientes no tiene por qué
   * depender de una feature hermana para una pregunta que es del core de caja.
   */
  cashRegisterEntryContext(): Observable<CashRegisterEntryContextDto> {
    return this.http.get<CashRegisterEntryContextDto>(
      apiUrl(API_ENDPOINTS.CASH_REGISTERS.ENTRY_CONTEXT),
    );
  }

  /**
   * `POST /checking-account/credit/preview` — qué haría el FIFO con un importe, antes de cobrarlo.
   *
   * Lo calcula la **misma función** del backend que después escribe las filas, así que la previa
   * coincide con lo que queda imputado por construcción. Es una foto, no una reserva: si entre la
   * previa y el cobro alguien imputa contra esas deudas, el reparto real va a ser otro.
   */
  previewAllocation(accountUuid: string, amount: number): Observable<AllocationPreviewDto> {
    return this.http.post<AllocationPreviewDto>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PREVIEW),
      { accountUuid, amount } satisfies PreviewAllocationRequest,
    );
  }

  /**
   * `POST /payment-method/paginate` — los medios que ofrece el alta de cobro.
   *
   * **El medio `ACCOUNT` se saca acá**, no en la pantalla: cobrar una deuda de cuenta corriente con
   * el medio «cuenta corriente» sería pagarla con ella misma, y el backend lo rechaza. Que no llegue
   * a ofrecerse es cortesía; que el backend lo rechace es la validación.
   */
  paymentMethods(): Observable<readonly PaymentMethodOption[]> {
    return this.http
      .post<PaginationData<PaymentMethodOption>>(apiUrl(API_ENDPOINTS.PAYMENT_METHODS.PAGINATE), {
        page: 1,
        size: 100,
        filtros: [],
        relaciones: [],
        ordenes: [],
      })
      .pipe(
        map((page) =>
          (page.content ?? []).filter((method) => method.code?.toUpperCase() !== 'ACCOUNT'),
        ),
      );
  }

  /* ────────────────────────────────  Escrituras  ──────────────────────────────── */

  /**
   * `POST /checking-account/credit` — registrar el cobro de un cliente o el pago a un proveedor.
   *
   * Un solo endpoint para los dos: cuál es lo dice el rol de la cuenta, no el request. La respuesta
   * vuelve con `allocations` —qué deudas canceló el FIFO— y con `unallocatedAmount` ya neteado.
   */
  registerCredit(request: RegisterCreditRequest): Observable<CheckingAccountCreditRowDto> {
    return this.http.post<CheckingAccountCreditRowDto>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT),
      request,
    );
  }

  /**
   * `POST /checking-account/credit/{uuid}/allocate` — aplicar el cobro a una o varias deudas.
   *
   * **No mueve dinero**: no toca la caja, no emite comprobante y no exige sesión. Sólo redistribuye
   * lo que ya entró — que es exactamente lo que hace segura la desimputación.
   */
  allocate(
    creditUuid: string,
    allocations: readonly AllocationInput[],
  ): Observable<readonly CheckingAccountAllocationRowDto[]> {
    return this.http.post<readonly CheckingAccountAllocationRowDto[]>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT}/${creditUuid}/allocate`),
      { allocations } satisfies AllocateRequest,
    );
  }

  /**
   * `POST /checking-account/allocation/{uuid}/reverse` — desimputar, total o parcialmente.
   *
   * Devuelve la fila `REVERSAL` que escribió: el libro es append-only, así que deshacer **agrega**.
   */
  reverseAllocation(
    allocationUuid: string,
    request: ReverseRequest,
  ): Observable<CheckingAccountAllocationRowDto> {
    return this.http.post<CheckingAccountAllocationRowDto>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION}/${allocationUuid}/reverse`),
      request,
    );
  }

  /**
   * `POST /checking-account/allocation/{uuid}/reverse/preview` — el antes y el después.
   *
   * Lo pide el diálogo mientras alguien mueve el importe. **El estado de la deuda lo deriva el
   * servidor**: se evalúa contra la fecha de hoy, y el reloj que decide no puede ser el de la
   * máquina del operador.
   */
  previewReverse(allocationUuid: string, amount?: number): Observable<ReversePreviewDto> {
    return this.http.post<ReversePreviewDto>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION}/${allocationUuid}/reverse/preview`),
      amount != null ? { amount } : {},
    );
  }

  /**
   * `POST /checking-account/allocation/{uuid}/reassign` — mover una imputación a otra deuda.
   *
   * Devuelve las **dos** filas encadenadas: el `REVERSAL` y la `ALLOCATION` nueva. Es una sola
   * operación a propósito — el usuario no debería poder quedarse a mitad de camino.
   */
  reassignAllocation(
    allocationUuid: string,
    request: ReassignRequest,
  ): Observable<readonly CheckingAccountAllocationRowDto[]> {
    return this.http.post<readonly CheckingAccountAllocationRowDto[]>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION}/${allocationUuid}/reassign`),
      request,
    );
  }

  /**
   * `GET /checking-account/allocation/{uuid}/trace` — a dónde fue esa plata.
   *
   * Las cinco preguntas de §8.4 en una respuesta, con el recorrido hacia adelante ya resuelto por
   * una consulta recursiva: la pantalla ordena por `depth` y no vuelve a preguntar por cada salto.
   */
  traceAllocation(allocationUuid: string): Observable<AllocationTraceDto> {
    return this.http.get<AllocationTraceDto>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION}/${allocationUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.TRACE_SUFFIX,
      ),
    );
  }

  /**
   * `POST /checking-account/credit/{uuid}/void` — anular un cobro que no debió existir.
   *
   * **No es desimputar.** Desimputar deshace el vínculo con una deuda y no mueve ni el saldo ni la
   * caja; anular deshace el ingreso de dinero: el saldo sube por el importe entero y la plata sale
   * del cajón. Por eso son dos permisos distintos y dos palabras distintas en la pantalla.
   */
  voidCredit(creditUuid: string, request: VoidCreditRequest): Observable<CheckingAccountCreditDto> {
    return this.http.post<CheckingAccountCreditDto>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT}/${creditUuid}/void`),
      request,
    );
  }

  /**
   * Qué deudas vuelven a quedar impagas y en cuánto queda el saldo, antes de anular.
   *
   * Es lo que hace que la confirmación signifique algo: «se revierten 2 imputaciones» no le dice
   * nada a nadie; «la factura 0001-00000042 vuelve a estar VENCIDA por $12.100» sí.
   */
  previewVoid(creditUuid: string): Observable<VoidPreviewDto> {
    return this.http.post<VoidPreviewDto>(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT}/${creditUuid}/void/preview`),
      {},
    );
  }

  /* ────────────────────────────────  Transporte  ──────────────────────────────── */

  /**
   * `defer` es lo que hace que cada suscripción lea el estado del momento: sin él, un `of(...)`
   * congelaría la respuesta en el instante en que se armó el observable, y refrescar un listado
   * después de cobrar devolvería lo de antes.
   */
  private read<T>(produce: () => T): Observable<T> {
    return defer(() => this.settle(produce)).pipe(delay(READ_LATENCY_MS));
  }

  private write<T>(produce: () => T): Observable<T> {
    return defer(() => this.settle(produce)).pipe(delay(WRITE_LATENCY_MS));
  }

  /** Traduce el error de dominio del almacén en un error del observable, como haría un 400. */
  private settle<T>(produce: () => T): Observable<T> {
    try {
      return of(produce());
    } catch (error) {
      return throwError(() => (error instanceof MockApiError ? error : new Error(String(error))));
    }
  }
}
