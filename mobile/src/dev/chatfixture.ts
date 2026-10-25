import type { Msg } from '../lib/types';

const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
export const PREVIEW_IMG = 'https://xzsibbbghotreolzwnyk.supabase.co/storage/v1/object/public/product-images/100416/black-strata-0.jpg';
const SITE = 'https://chat.hdsgroup.co.za';

export const CHAT_FIXTURE: Msg[] = [
  { id: 'pv-1', direction: 'out', sender: 'bot', type: 'text', status: 'read', created_at: at(48), payload: {},
    body: 'Hi Sipho! William here from HDS. What can I help you with today?' },
  { id: 'pv-2', direction: 'in', sender: 'customer', type: 'text', status: 'read', created_at: at(45), payload: {},
    body: 'Hi, I need board colours for a kitchen renovation' },
  { id: 'pv-3', direction: 'out', sender: 'bot', type: 'image', status: 'read', created_at: at(40), payload: {},
    body: 'Here is our Black Strata finish — one of the most popular for modern kitchens.', media_url: PREVIEW_IMG },
  { id: 'pv-4', direction: 'out', sender: 'bot', type: 'carousel', status: 'read', created_at: at(30),
    payload: { cards: [
      { image: PREVIEW_IMG, text: '*Black Strata* — matte finish, 16mm', buttons: [{ text: 'View product', url: SITE }], quick_replies: ['Quote this'] },
      { image: PREVIEW_IMG, text: '*Black Strata* — 18mm variant', buttons: [{ text: 'View product', url: SITE }] },
      { image: 'https://invalid.invalid/missing.jpg', text: '*Broken card* — exercises the image fallback', quick_replies: ['Something else'] },
    ] } },
  { id: 'pv-5', direction: 'in', sender: 'customer', type: 'text', status: 'failed', created_at: at(12), payload: { error: 'No connection.' },
    body: 'Can you quote 6 sheets?' },
  { id: 'pv-6', direction: 'out', sender: 'bot', type: 'text', status: 'read', created_at: at(2),
    payload: { quick_replies: ['I need a quote', 'Nearest branch', 'Board colours'] },
    body: 'Anything else I can help with?' },
];
