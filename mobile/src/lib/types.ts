export type Status = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Quote {
  quote_number: string; short_number: string; created_at: string; expires_at: string | null;
  total: number; vat: number | null; branch: string | null; project: string | null;
  status: 'open' | 'paid' | 'expired' | 'superseded';
  pdf_url: string; cutlist_url: string | null;
  invoice: { number: string; status: string; pdf_url: string | null; total: number } | null;
  lines: { label: string; amount: number | null }[];
}

export interface Msg {
  id: string;                 // server id, or 'local:<client_id>' while pending
  client_id?: string | null;
  direction: 'in' | 'out';
  sender: 'customer' | 'bot' | 'agent' | 'system';
  sender_name?: string | null;
  type: string;
  body?: string | null;
  media_url?: string | null;
  payload: Record<string, any>;
  status: Status;
  bot_status?: string | null;
  created_at: string;
  wa_id?: string | null;
  // local only
  phone?: string;
  localUri?: string;
}

export interface OutboxItem {
  client_id: string;
  phone: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'location' | 'interactive';
  body?: string;
  uri?: string;
  filename?: string;
  mime?: string;
  location?: { lat: number; lon: number; name?: string };
  reply_to?: string;
  reply_preview?: string;
  media_id?: string;
  created_at: string;
  attempts: number;
}

export interface Me { id: string; phone: string; name: string | null; topic: string }
