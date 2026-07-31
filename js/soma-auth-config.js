// SOMA Auth config for Community Seed.
// Publishable key — safe in client-side code.
//
// Auth is OPTIONAL on this site: the page and every seed document are public.
// Signing in unlocks exactly one capability — creating invite links/QRs that
// carry your name to the person you invite (see index.html + seed_invite_*
// RPCs in the shared SOMA Auth Supabase project).
window.SOMA_AUTH_CONFIG = {
  url: 'https://omfwcodoimjmbrhssvfl.supabase.co',
  anonKey: 'sb_publishable_vi2qDWjozUJ5mi9dwirkLA_rj6UaqLf',

  methods: {
    magicLink: true,      // passwordless email link (default SOMA method)
    emailOtp:  false,
    password:  false,     // keep the door simple — magic link + Google only
    phone:     false,
    oauth:     ['google']
  }
};
