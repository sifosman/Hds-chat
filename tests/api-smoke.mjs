// Compatibility entry point. The early prototype smoke used a synthetic OTP bypass and did not
// reject foreign document URLs. Those expectations were deliberately replaced by the hardened suite.
// Run live-core.mjs first to create an owned synthetic quote fixture. Never use real customer phones.
await import('./live-security.mjs');
