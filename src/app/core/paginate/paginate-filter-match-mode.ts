/**
 * Filter match modes for Material tables.
 * Analogous to PrimeNG's FilterMatchMode, mapped to SQL operaciones by dialect.
 */
export enum FilterMatchMode {
  Equals = 'equals',
  NotEquals = 'notEquals',
  Contains = 'contains',
  StartsWith = 'startsWith',
  EndsWith = 'endsWith',
  LessThan = 'lt',
  LessThanOrEqualTo = 'lte',
  GreaterThan = 'gt',
  GreaterThanOrEqualTo = 'gte',
  In = 'in',
  Between = 'between',
  DateIs = 'dateIs',
  DateIsNot = 'dateIsNot',
  DateBefore = 'dateBefore',
  DateAfter = 'dateAfter',
  IsNull = 'isNull',
  IsNotNull = 'isNotNull',
}
