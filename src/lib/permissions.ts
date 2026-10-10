export const assignableRoles = ['ADMIN', 'SALES', 'PURCHASING', 'INVENTORY', 'STAFF'] as const;
export const roles = [...assignableRoles, 'PENDING'] as const;
export type Role = (typeof roles)[number];

export type Permission =
  | 'customers.write'
  | 'products.write'
  | 'inventory.write'
  | 'orders.write'
  | 'shipments.write'
  | 'invoices.write'
  | 'payments.write'
  | 'returns.write'
  | 'suppliers.write'
  | 'purchases.write'
  | 'purchases.receive'
  | 'users.write';

const grants: Record<Exclude<Role, 'ADMIN'>, readonly Permission[]> = {
  SALES: ['customers.write', 'orders.write', 'invoices.write', 'returns.write'],
  PURCHASING: ['suppliers.write', 'purchases.write'],
  INVENTORY: ['products.write', 'inventory.write', 'purchases.receive', 'shipments.write'],
  STAFF: [],
  PENDING: [],
};

export const asRole = (value: string): Role => roles.includes(value as Role) ? value as Role : 'STAFF';
export const can = (role: Role | undefined, permission: Permission): boolean =>
  role === 'ADMIN' || Boolean(role && grants[role as Exclude<Role, 'ADMIN'>]?.includes(permission));
