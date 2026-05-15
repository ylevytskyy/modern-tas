export interface RequestUser {
  sub: string;       // user UUID
  tenantId: string;  // tenant UUID
  role: 'operator' | 'admin' | 'supervisor';
}
