// REST DTOs — shape matches the /v1 wire format the CRM compatibility constraint requires.
// All timestamps are ISO-8601 strings (JSON serialized from Date).

export interface AccountDto {
  id: string;
  tenantId: string;
  name: string;
  createdAt: string;
}

export interface ContactDto {
  id: string;
  accountId: string;
  name: string;
  phone: string | null;
  createdAt: string;
}

export interface FormField {
  name: string;
  label: string;
  type: string;
}

export interface FormDto {
  id: string;
  accountId: string;
  name: string;
  schema: { fields: FormField[] };
  createdAt: string;
}

export interface CreateMessageDto {
  callId: string;
  accountId: string;
  operatorId: string;
  body: string;
}

export interface MessageCreatedDto {
  id: string;
  createdAt: string;
}
