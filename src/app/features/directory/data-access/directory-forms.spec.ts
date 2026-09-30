import { describe, expect, it } from 'vitest';
import { DetectedDirectoryLinkDto } from '../../../core/parties/directory-links';
import { PartyDto } from '../../../core/parties/party.model';
import {
  DirectoryFormModel,
  catalogsFor,
  decideExistingParty,
  extraLinkProfiles,
  initialRoleUuids,
  linksOfParty,
  mergeSuggestedRoles,
  onboardRequest,
  planExtraLinks,
  profilePayload,
  specialtyGrantBody,
  toFormModel,
  userLinkRequest,
} from './directory-forms';
import { SuggestedRoleDto, SellerProfileDto, TransportistProfileDto } from './directory.model';

function modelFor(
  link: Parameters<typeof toFormModel>[0],
  patch: Partial<DirectoryFormModel> = {},
): DirectoryFormModel {
  return { ...toFormModel(link, null), ...patch };
}

const JUAN: PartyDto = {
  uuid: 'party-juan',
  name: 'Juan Pérez',
  docType: 'CUIL',
  docNumber: '20-31456789-4',
  roles: [{ uuid: 'role-supplier', role: 'SUPPLIER' }],
};

const NO_VEHICLE = {
  licenseClass: null,
  licenseExpiresOn: null,
  vehiclePlate: null,
  vehicleDescription: null,
};

function detected(
  link: string,
  because: string[] = [],
  alreadyHas = false,
): DetectedDirectoryLinkDto {
  return { link, because, alreadyHas };
}

describe('onboardRequest', () => {
  it('sends no credential field when the customer access switch is off', () => {
    const model = modelFor('CUSTOMER', {
      name: 'Almacén Don Vito',
      access: {
        enabled: false,
        existingUserUuid: '',
        existingUsername: '',
        username: 'donvito',
        password: 'Tipeada1!',
        roleUuids: ['role-customer'],
      },
    });

    const request = onboardRequest('CUSTOMER', model, null);

    expect(request.user).toBeUndefined();
    expect(JSON.stringify(request)).not.toContain('donvito');
    expect(JSON.stringify(request)).not.toContain('Tipeada1!');
  });

  it('creates an employee with their user, roles, email contact and only the filled extra fields', () => {
    const model = modelFor('TRANSPORTIST', {
      name: 'Paula Brizuela',
      docType: 'DNI',
      docNumber: '39220145',
      email: 'pbrizuela@example.com',
      fileNumber: '',
      dateHired: '2026-09-01',
      branchUuid: 'branch-central',
      licenseNumber: '28.114.907',
      attributes: [
        { attributeUuid: 'attr-size', name: 'Talle', type: 'text', value: ' M ' },
        { attributeUuid: 'attr-union', name: 'Sindicato', type: 'text', value: '' },
      ],
      access: {
        enabled: true,
        existingUserUuid: '',
        existingUsername: '',
        username: ' pbrizuela ',
        password: 'Secreta1!',
        roleUuids: ['role-transportist'],
      },
    });

    const request = onboardRequest('TRANSPORTIST', model, null);

    expect(request.profile).toEqual({
      name: 'Paula Brizuela',
      docType: 'DNI',
      docNumber: '39220145',
      fileNumber: null,
      dateHired: '2026-09-01',
      branch: { uuid: 'branch-central' },
      licenseNumber: '28.114.907',
      ...NO_VEHICLE,
    });
    expect(request.contacts).toEqual([
      { type: 'EMAIL', value: 'pbrizuela@example.com', isPrincipal: true },
    ]);
    expect(request.attributes).toEqual([{ attributeUuid: 'attr-size', value: 'M' }]);
    expect(request.user).toEqual({
      username: 'pbrizuela',
      password: 'Secreta1!',
      email: 'pbrizuela@example.com',
      roleUuids: ['role-transportist'],
    });
  });

  /** Lo que se acababa de tipear no pisa la ficha que ya existe: ni la identidad ni los contactos. */
  it('adds the link to an existing party without sending contacts', () => {
    const model = modelFor('CUSTOMER', { name: 'Juan Pérez', email: 'otro@example.com' });

    const request = onboardRequest('CUSTOMER', model, 'party-juan');

    expect(request.profile['partyUuid']).toBe('party-juan');
    expect(request.contacts).toBeUndefined();
  });

  /** Los vínculos que piden los roles viajan con el usuario, y el legajo sólo con el primero de empleado. */
  it('sends the links the roles require with the user, employment only once', () => {
    const model = modelFor('CUSTOMER', {
      name: 'Martita Ríos',
      dateHired: '2026-09-16',
      branchUuid: 'branch-central',
      licenseNumber: ' B-114 ',
      access: {
        enabled: true,
        existingUserUuid: '',
        existingUsername: '',
        username: 'martita',
        password: 'Secreta1!',
        roleUuids: ['role-martita'],
      },
    });
    const plan = planExtraLinks(
      [detected('TRANSPORTIST'), detected('BUYER'), detected('CUSTOMER')],
      [],
      'CUSTOMER',
      false,
    );

    const request = onboardRequest('CUSTOMER', model, null, plan);

    expect(request.user?.links).toEqual([
      {
        link: 'BUYER',
        profile: { fileNumber: null, dateHired: '2026-09-16', branch: { uuid: 'branch-central' } },
      },
      { link: 'TRANSPORTIST', profile: { licenseNumber: 'B-114', ...NO_VEHICLE } },
    ]);
  });

  it('links the user the person already has instead of creating one', () => {
    const access = {
      enabled: true,
      existingUserUuid: 'user-juan',
      existingUsername: 'jperez',
      username: 'ignorado',
      password: 'ignorada',
      roleUuids: ['role-transportist'],
    };

    expect(userLinkRequest(access, 'x@example.com')).toEqual({
      userUuid: 'user-juan',
      roleUuids: ['role-transportist'],
    });
  });
});

describe('profilePayload', () => {
  it('does not send the VAT status from a person record', () => {
    const payload = profilePayload(
      'TRANSPORTIST',
      modelFor('TRANSPORTIST', { taxCondition: 'MONOTRIBUTO' }),
    );

    expect(payload).not.toHaveProperty('taxCondition');
  });

  it('sends the VAT status from a customer or supplier record', () => {
    const payload = profilePayload('SUPPLIER', modelFor('SUPPLIER', { taxCondition: ' EXENTO ' }));

    expect(payload['taxCondition']).toBe('EXENTO');
  });

  /** Toda ficha de empleado manda la sucursal donde trabaja, también la que no pregunta nada más. */
  it('sends the workplace branch from every employee record', () => {
    const payload = profilePayload('BUYER', modelFor('BUYER', { branchUuid: 'branch-north' }));

    expect(payload['branch']).toEqual({ uuid: 'branch-north' });
  });

  /** La lista del cliente y la del vendedor son dos campos: la misma persona puede ser las dos cosas. */
  it('keeps the customer and the seller price lists apart', () => {
    const model = modelFor('CUSTOMER', {
      priceListUuid: 'list-customer',
      sellerPriceListUuid: 'list-seller',
    });

    expect(profilePayload('CUSTOMER', model)['priceList']).toEqual({ uuid: 'list-customer' });
    expect(profilePayload('SELLER', model)['priceList']).toEqual({ uuid: 'list-seller' });
  });

  it('reads the seller list into its own field when editing a seller', () => {
    const seller: SellerProfileDto = {
      uuid: 'role-seller',
      name: 'Mariela Godoy',
      priceList: { uuid: 'list-seller', name: 'Mayorista' },
    };

    const model = toFormModel('SELLER', seller);

    expect(model.sellerPriceListUuid).toBe('list-seller');
    expect(model.priceListUuid).toBe('');
  });

  it('reads the employment and the vehicle when editing a transportist', () => {
    const transportist: TransportistProfileDto = {
      uuid: 'role-transportist',
      name: 'Héctor Quiroga',
      fileNumber: '0114',
      dateHired: '2026-03-03',
      branch: { uuid: 'branch-north', name: 'Norte' },
      licenseNumber: '28.114.907',
      vehiclePlate: 'AB 412 KL',
    };

    const model = toFormModel('TRANSPORTIST', transportist);

    expect(model.fileNumber).toBe('0114');
    expect(model.dateHired).toBe('2026-03-03');
    expect(model.branchUuid).toBe('branch-north');
    expect(model.licenseNumber).toBe('28.114.907');
    expect(model.vehiclePlate).toBe('AB 412 KL');
  });

  it('keeps the version it was read with when editing', () => {
    const payload = profilePayload('CUSTOMER', modelFor('CUSTOMER', { name: 'Kiosco' }), {
      uuid: 'role-1',
      version: 4,
    });

    expect(payload['uuid']).toBe('role-1');
    expect(payload['version']).toBe(4);
  });

  it('drops a document type without number, which the backend would reject as incomplete', () => {
    const payload = profilePayload(
      'CUSTOMER',
      modelFor('CUSTOMER', { docType: 'CUIT', docNumber: ' ' }),
    );

    expect(payload['docType']).toBeNull();
    expect(payload['docNumber']).toBeNull();
  });
});

describe('specialtyGrantBody', () => {
  it('sends only the data block of the specialty it grants', () => {
    const body = specialtyGrantBody(
      'TRANSPORTIST',
      modelFor('TRANSPORTIST', {
        licenseNumber: '28.114.907',
        licenseClass: 'd2',
        licenseExpiresOn: '2026-11-14',
        vehiclePlate: 'AB 412 KL',
        vehicleDescription: 'Utilitario',
        sellerPriceListUuid: 'no-viaja',
      }),
    );

    expect(body).toEqual({
      specialty: 'TRANSPORTIST',
      transportist: {
        licenseNumber: '28.114.907',
        licenseClass: 'd2',
        licenseExpiresOn: '2026-11-14',
        vehiclePlate: 'AB 412 KL',
        vehicleDescription: 'Utilitario',
      },
    });
  });
});

describe('specialtyGrantBody without data', () => {
  /** El comprador no tiene satélite: un bloque vacío no tendría dónde leerse. */
  it('grants the buyer without a data block', () => {
    expect(specialtyGrantBody('BUYER', modelFor('BUYER'))).toEqual({ specialty: 'BUYER' });
  });
});

describe('planExtraLinks', () => {
  it('asks the links the roles require besides the form one, in the directory order', () => {
    const plan = planExtraLinks(
      [detected('BUYER'), detected('CUSTOMER'), detected('SELLER')],
      [],
      'CUSTOMER',
      false,
    );

    expect(plan.links).toEqual(['SELLER', 'BUYER']);
    expect(plan.employmentLink).toBe('SELLER');
  });

  it('does not ask what the person already is, nor a link the front does not know', () => {
    const plan = planExtraLinks(
      [detected('TRANSPORTIST', [], true), detected('PILOT'), detected('SUPPLIER')],
      [],
      'CUSTOMER',
      false,
    );

    expect(plan.links).toEqual(['SUPPLIER']);
    expect(plan.employmentLink).toBeNull();
  });

  /** Lo que el backend dijo que faltaba al guardar aparece aunque la detección no lo haya traído. */
  it('adds the links the backend reported missing', () => {
    expect(planExtraLinks([], ['TRANSPORTIST'], 'CUSTOMER', false).links).toEqual(['TRANSPORTIST']);
  });

  it('asks no employment when the form or the person already has it', () => {
    const roles = [detected('TRANSPORTIST'), detected('BUYER')];

    expect(planExtraLinks(roles, [], 'SELLER', false).employmentLink).toBeNull();
    expect(planExtraLinks(roles, [], 'CUSTOMER', true).employmentLink).toBeNull();
    expect(planExtraLinks(roles, [], null, false).employmentLink).toBe('BUYER');
  });

  it('sends no employment data when the person is already an employee', () => {
    const plan = planExtraLinks([detected('TRANSPORTIST')], [], null, true);

    expect(
      extraLinkProfiles(plan, modelFor(null, { fileNumber: '12', licenseNumber: 'B-1' })),
    ).toEqual([{ link: 'TRANSPORTIST', profile: { licenseNumber: 'B-1', ...NO_VEHICLE } }]);
  });
});

describe('catalogsFor', () => {
  it('loads each catalog only for the links whose fields use it', () => {
    expect(catalogsFor(['SUPPLIER', 'BUYER'])).toEqual({ branches: true, priceLists: false });
    expect(catalogsFor(['CUSTOMER', 'TRANSPORTIST'])).toEqual({
      branches: true,
      priceLists: true,
    });
    expect(catalogsFor(['SUPPLIER'])).toEqual({ branches: false, priceLists: false });
  });
});

describe('decideExistingParty', () => {
  it('opens the record when the person already has this link', () => {
    expect(decideExistingParty('SUPPLIER', JUAN)).toEqual({
      kind: 'open',
      party: JUAN,
      recordUuid: 'role-supplier',
    });
  });

  it('offers to add the link when the person has another one', () => {
    expect(decideExistingParty('CUSTOMER', JUAN).kind).toBe('addLink');
    expect(decideExistingParty('TRANSPORTIST', JUAN).kind).toBe('addLink');
  });

  it('opens the type record when the employee already has that specialty', () => {
    const employee = { ...JUAN, roles: [{ uuid: 'role-employee', role: 'EMPLOYEE' as const }] };

    expect(decideExistingParty('TRANSPORTIST', employee, ['BUYER', 'TRANSPORTIST'])).toEqual({
      kind: 'open',
      party: employee,
      recordUuid: 'role-employee',
    });
  });

  /** Ya es empleado: se le otorga la especialidad, no se crea otro empleado con otro legajo. */
  it('offers the specialty when the employee has only other ones', () => {
    const employee = { ...JUAN, roles: [{ uuid: 'role-employee', role: 'EMPLOYEE' as const }] };

    expect(decideExistingParty('SELLER', employee, ['BUYER'])).toEqual({
      kind: 'addSpecialty',
      party: employee,
      employeeUuid: 'role-employee',
      specialties: ['BUYER'],
    });
  });
});

describe('suggested roles', () => {
  const suggested: SuggestedRoleDto[] = [
    { uuid: 'role-seller', name: 'SELLER', system: true, grantable: true },
    { uuid: 'role-caja', name: 'Caja mostrador', system: false, grantable: true },
    { uuid: 'role-transportist', name: 'TRANSPORTIST', system: true, grantable: false },
  ];

  /** Uno que quien carga no puede otorgar no se elige solo: sería un 403 seguro al guardar. */
  it('starts with the system roles that can be granted', () => {
    expect(initialRoleUuids(suggested)).toEqual(['role-seller']);
  });

  it('merges the suggestions of several links without repeating a role', () => {
    const merged = mergeSuggestedRoles([suggested, [suggested[0]]]);

    expect(merged.map((role) => role.uuid)).toEqual([
      'role-seller',
      'role-caja',
      'role-transportist',
    ]);
  });

  it('reads the links of a person from their roles and specialties', () => {
    const party: PartyDto = {
      ...JUAN,
      roles: [
        { uuid: 'r1', role: 'CUSTOMER' },
        { uuid: 'r2', role: 'EMPLOYEE' },
      ],
    };

    expect(linksOfParty(party, ['SELLER', 'UNKNOWN'])).toEqual(['CUSTOMER', 'SELLER']);
  });
});
