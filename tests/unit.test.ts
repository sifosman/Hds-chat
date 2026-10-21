import { describe, expect, it } from 'vitest';
import { metaInbound, renderTemplate, translateOutbound } from '../server/translate.js';
import { normalizePhone } from '../server/util.js';

describe('normalizePhone', () => {
  it.each([
    ['0821234567', '27821234567'], ['082 123 4567', '27821234567'], ['+27 82 123 4567', '27821234567'],
    ['27821234567', '27821234567'], ['+27 082 123 4567', '27821234567'], ['821234567', '27821234567'],
    ['0027821234567', '27821234567'], ['+44 7911 123456', '447911123456'],
  ])('%s → %s', (i, o) => expect(normalizePhone(i)).toBe(o));
  it.each(['', '123', 'abc', '0021234', '2701234567', null, undefined, '27 12'])('rejects %s', i => expect(normalizePhone(i as any)).toBeNull());
});

describe('translateOutbound (payloads copied from William prod nodes)', () => {
  it('Send WhatsApp Reply text', () => {
    const t = translateOutbound({ messaging_product: 'whatsapp', to: '27821234567', type: 'text', text: { body: 'Hi there' } });
    expect(t).toEqual({ kind: 'message', to: '27821234567', msg: { type: 'text', body: 'Hi there', payload: {} } });
  });
  it('Send WhatsApp Reply quote PDF document', () => {
    const t: any = translateOutbound({ messaging_product: 'whatsapp', to: '27821234567', type: 'document', document: {
      link: 'https://xzsibbbghotreolzwnyk.supabase.co/storage/v1/object/public/hdsquotes/Q-20260101-0001-TEST-f00df00d',
      caption: 'Here is your quote', filename: 'HDS_Quote_Q-20261021-0031_Sizwe.pdf' } });
    expect(t.msg.type).toBe('document');
    expect(t.msg.payload.quote_ref).toBe('Q-20260101-0001-TEST-f00df00d');
    expect(t.msg.body).toBe('Here is your quote');
  });
  it('quote PDF with & in branch code', () => {
    const t: any = translateOutbound({ to: '27821234567', type: 'document', document: { link: 'https://xzsibbbghotreolzwnyk.supabase.co/storage/v1/object/public/hdsquotes/Q-20260101-0002-STUCUT&-f00df00d' } });
    expect(t.msg.payload.quote_ref).toBe('Q-20260101-0002-STUCUT&-f00df00d');
  });
  it('Store User Message read + typing', () => {
    expect(translateOutbound({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.APPX', typing_indicator: { type: 'text' } }))
      .toEqual({ kind: 'read', message_id: 'wamid.APPX', typing: true });
  });
  it('show_products carousel', () => {
    const t: any = translateOutbound({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '27821234567', type: 'interactive', interactive: {
      type: 'carousel', body: { text: 'Here are some options' }, action: { cards: [
        { card_index: 0, type: 'cta_url', header: { type: 'image', image: { link: 'https://x/a.jpg' } }, body: { text: 'Oak R995' }, action: { name: 'cta_url', parameters: { display_text: 'View our range', url: 'https://hdsgroup.co.za' } } },
      ] } } });
    expect(t.msg.type).toBe('carousel');
    expect(t.msg.payload.cards[0]).toEqual({ image: 'https://x/a.jpg', text: 'Oak R995', buttons: [{ text: 'View our range', url: 'https://hdsgroup.co.za' }] });
  });
  it('spin_and_win cta_url', () => {
    const t: any = translateOutbound({ to: '27821234567', type: 'interactive', interactive: { type: 'cta_url', body: { text: 'Spin!' }, footer: { text: 'One spin' }, action: { name: 'cta_url', parameters: { display_text: 'Spin now', url: 'https://hds-spin.vercel.app/s/abc' } } } });
    expect(t.msg).toEqual({ type: 'text', media_url: null, body: 'Spin!', payload: { footer: 'One spin', buttons: [{ text: 'Spin now', url: 'https://hds-spin.vercel.app/s/abc' }] } });
  });
  it('reply buttons → quick replies', () => {
    const t: any = translateOutbound({ to: '27821234567', type: 'interactive', interactive: { type: 'button', body: { text: 'Paid?' }, action: { buttons: [{ type: 'reply', reply: { id: 'y', title: 'YES' } }, { type: 'reply', reply: { id: 'n', title: 'NO' } }] } } });
    expect(t.msg.payload.quick_replies).toEqual(['YES', 'NO']);
  });
  it('generate_after_image image', () => {
    const t: any = translateOutbound({ to: '+27821234567', type: 'image', image: { link: 'https://x/after.png', caption: 'Your kitchen' } });
    expect(t).toMatchObject({ to: '27821234567', msg: { type: 'image', media_url: 'https://x/after.png', body: 'Your kitchen' } });
  });
  it('template', () => {
    const t: any = translateOutbound({ to: '27821234567', type: 'template', template: { name: 'hds_branch_payment_check', components: [{ type: 'body', parameters: [{ type: 'text', text: 'Soweto' }, { type: 'text', text: 'Q-1' }] }] } });
    expect(renderTemplate('Hi {{1}}, check {{2}}', t.msg.payload.template)).toBe('Hi Soweto, check Q-1');
  });
});

describe('metaInbound is parseable by Extract Meta Payload', () => {
  // the node's core logic, copied verbatim (minus n8n globals)
  const extract = (body: any) => {
    const value = body?.entry?.[0]?.changes?.[0]?.value; const msg = value.messages[0]; const contact = value.contacts[0];
    const t = msg.type; let text = '', imageId = '', mediaId = '';
    if (t === 'text') text = msg.text?.body || '';
    else if (t === 'image') { imageId = msg.image?.id || ''; text = msg.image?.caption || ''; }
    else if (t === 'document' || t === 'audio') mediaId = msg[t]?.id || '';
    else if (t === 'interactive') text = msg.interactive.button_reply?.title || '';
    return { phone: msg.from, name: contact?.profile?.name, text, imageId, mediaId, messageId: msg.id, msgType: t };
  };
  it('text', () => {
    const b = metaInbound({ phone: '27821234567', name: 'Sam', waId: 'wamid.APP1', type: 'text', text: 'hello', phoneNumberId: 'hdsapp', displayNumber: '27679020239' });
    expect(extract(b)).toEqual({ phone: '27821234567', name: 'Sam', text: 'hello', imageId: '', mediaId: '', messageId: 'wamid.APP1', msgType: 'text' });
  });
  it('image with caption', () => {
    const b = metaInbound({ phone: '27821234567', name: 'Sam', waId: 'w', type: 'image', mediaId: 'uuid-1', mime: 'image/jpeg', text: 'my list', phoneNumberId: 'x', displayNumber: 'y' });
    expect(extract(b)).toMatchObject({ imageId: 'uuid-1', text: 'my list' });
  });
  it('quick reply', () => {
    const b = metaInbound({ phone: '27821234567', name: 'S', waId: 'w', type: 'interactive', text: 'YES', phoneNumberId: 'x', displayNumber: 'y' });
    expect(extract(b).text).toBe('YES');
  });
});
