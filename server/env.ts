// [HDS-APP-2026-10-21] Central config. All secrets come from env (Vercel project env / local .env.local).
const e = (k: string, d = '') => (process.env[k] ?? d).trim();

export const ENV = {
  SUPABASE_URL: e('SUPABASE_URL', 'https://xzsibbbghotreolzwnyk.supabase.co'),
  SUPABASE_SECRET_KEY: e('SUPABASE_SECRET_KEY'),
  SUPABASE_PUBLISHABLE_KEY: e('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_y2PC2TFlxHK0sneFtwqxeg_3uTHyUuu'),
  PUBLIC_URL: e('PUBLIC_URL', 'https://chat.hdsgroup.co.za'),
  // shared secret embedded in the gateway path the n8n app workflow calls
  GATEWAY_SECRET: e('GATEWAY_SECRET'),
  // n8n "HDS App Channel" webhook + header secret
  N8N_APP_WEBHOOK_URL: e('N8N_APP_WEBHOOK_URL', 'https://n8n.owdsolutions.co.za/webhook/hds-app-channel'),
  N8N_APP_KEY: e('N8N_APP_KEY'),
  // phone_number_id we present to the bot in webhook payloads (any stable id)
  APP_PHONE_NUMBER_ID: e('APP_PHONE_NUMBER_ID', 'hdsapp'),
  APP_DISPLAY_NUMBER: e('APP_DISPLAY_NUMBER', '27787060895'),
  // Chatwoot "HDS App" API inbox
  CHATWOOT_URL: e('CHATWOOT_URL', 'https://chat.owdsolutions.co.za'),
  CHATWOOT_TOKEN: e('CHATWOOT_TOKEN'),
  CHATWOOT_ACCOUNT_ID: e('CHATWOOT_ACCOUNT_ID', '1'),
  CHATWOOT_APP_INBOX_ID: e('CHATWOOT_APP_INBOX_ID'),
  CHATWOOT_WEBHOOK_SECRET: e('CHATWOOT_WEBHOOK_SECRET'),
  // internal callers (n8n invite tool, ops scripts)
  INTERNAL_KEY: e('INTERNAL_KEY'),
  // Web push
  VAPID_PUBLIC_KEY: e('VAPID_PUBLIC_KEY'),
  VAPID_PRIVATE_KEY: e('VAPID_PRIVATE_KEY'),
  VAPID_SUBJECT: e('VAPID_SUBJECT', 'mailto:sifosman@gmail.com'),
  // OTP delivery
  WA_TOKEN: e('WA_TOKEN'),
  WA_PHONE_ID: e('WA_PHONE_ID', '1193389483847746'),
  // approved AUTHENTICATION template for OTPs outside the 24h window (WABA 651569391231371)
  WA_OTP_TEMPLATE: e('WA_OTP_TEMPLATE', 'hds_app_otp'),
  SMS_PROVIDER: e('SMS_PROVIDER'), // 'smsportal' | 'bulksms' | ''
  SMS_USER: e('SMS_USER'),
  SMS_PASS: e('SMS_PASS'),
  SMS_SENDER: e('SMS_SENDER', 'HDS'),
  BREVO_API_KEY: e('BREVO_API_KEY'),
  EMAIL_FROM: e('EMAIL_FROM', 'quotes@hdsgroup.co.za'),
  // test phones 2790000xxxx accept this fixed code (never sent anywhere)
  TEST_OTP_CODE: e('TEST_OTP_CODE'),
  ANDROID_APK_URL: e('ANDROID_APK_URL'),
};

export const isTestPhone = (p: string) => /^2790000\d{4}$/.test(p);
