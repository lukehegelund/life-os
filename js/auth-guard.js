// Life OS — Auth Guard
// Include this as the FIRST script in every protected HTML page.
// Redirects to login.html immediately if session is expired or missing.
// Usage: <script type="module" src="js/auth-guard.js"></script>

import { requireAuth } from './auth.js';
requireAuth();
