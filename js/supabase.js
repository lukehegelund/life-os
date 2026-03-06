// Life OS — Secure Database Client
// All requests are routed through the db-proxy Edge Function (service_role)
// The anon key below has NO table access (RLS blocks everything)

const PROXY_URL = 'https://kxsuzgpnvtepsyhkezin.supabase.co/functions/v1/db-proxy';

// ── Error reporter shim ───────────────────────────────────────────────────────
// Reports Supabase proxy errors to the console_errors table.
// Uses a separate fetch directly (never routes through ProxyQueryBuilder,
// to avoid infinite loops if console_errors itself has a proxy error).
const PAGE = window.location.pathname.split('/').pop() || 'index.html';
const _recentDbErrors = new Map();

function _reportDbError(message, context) {
  // Never report errors from console_errors itself (avoid infinite loops)
  if (context?.table === 'console_errors') return;

  // Deduplicate: same message within 10 seconds
  const now = Date.now();
  if (_recentDbErrors.has(message) && now - _recentDbErrors.get(message) < 10_000) return;
  _recentDbErrors.set(message, now);

  // Fire-and-forget via raw fetch (bypasses ProxyQueryBuilder entirely)
  fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table: 'console_errors',
      op: 'insert',
      data: {
        page: PAGE,
        message: String(message).slice(0, 500),
        stack: context ? JSON.stringify(context).slice(0, 2000) : null,
        error_type: 'supabase_error',
        status: 'open',
      },
    }),
  }).catch(() => {}); // silently swallow any failure here
}

// Minimal query builder that mirrors the supabase-js chained API
// but sends everything to the secure proxy instead of directly to PostgREST
class ProxyQueryBuilder {
  constructor(table) {
    this._table = table;
    this._op = 'select';
    this._filters = {};
    this._data = null;
    this._select = '*';
    this._selectCalled = false; // tracks if .select() was explicitly called (for insert/update chaining)
    this._order = [];
    this._limit = null;
    this._single = false;
    this._maybeSingle = false;
    this._count = null;
    this._head = false;
    this._upsertOpts = null;
  }

  // --- Operation setters ---
  select(cols = '*', opts = {}) {
    this._select = cols;
    this._selectCalled = true;
    // Only set op to 'select' if no mutation op is already set.
    // When chained after insert/update/upsert (.insert(data).select()), we want
    // to return the inserted/updated row — do NOT overwrite the mutation op.
    if (!['insert', 'update', 'upsert', 'delete'].includes(this._op)) {
      this._op = 'select';
    }
    if (opts && opts.count) this._count = opts.count;
    if (opts && opts.head)  this._head  = true;
    return this;
  }
  insert(data) { this._op = 'insert'; this._data = data; return this; }
  update(data) { this._op = 'update'; this._data = data; return this; }
  delete() { this._op = 'delete'; return this; }
  upsert(data, opts = {}) {
    this._op = 'upsert';
    this._data = data;
    if (opts && Object.keys(opts).length) this._upsertOpts = opts;
    return this;
  }

  // --- Filter methods ---
  eq(col, val)  { this._filters.eq  = { ...(this._filters.eq  || {}), [col]: val }; return this; }
  neq(col, val) { this._filters.neq = { ...(this._filters.neq || {}), [col]: val }; return this; }
  gte(col, val) { this._filters.gte = { ...(this._filters.gte || {}), [col]: val }; return this; }
  lte(col, val) { this._filters.lte = { ...(this._filters.lte || {}), [col]: val }; return this; }
  gt(col, val)  { this._filters.gt  = { ...(this._filters.gt  || {}), [col]: val }; return this; }
  lt(col, val)  { this._filters.lt  = { ...(this._filters.lt  || {}), [col]: val }; return this; }
  like(col, val)   { this._filters.like   = { ...(this._filters.like   || {}), [col]: val }; return this; }
  ilike(col, val)  { this._filters.ilike  = { ...(this._filters.ilike  || {}), [col]: val }; return this; }
  is(col, val)     { this._filters.is     = { ...(this._filters.is     || {}), [col]: val }; return this; }
  in(col, vals)    { this._filters.in     = { ...(this._filters.in     || {}), [col]: vals }; return this; }
  contains(col, val) { this._filters.contains = { ...(this._filters.contains || {}), [col]: val }; return this; }
  overlaps(col, val) { this._filters.overlaps = { ...(this._filters.overlaps || {}), [col]: val }; return this; }
  // .not(col, operator, value) — e.g. .not('notes', 'like', '%claude_schedule%')
  not(col, op, val)  { this._filters.not = [...(this._filters.not || []), { col, op, val }]; return this; }
  or(query) { this._filters.or = query; return this; }

  // --- Modifiers ---
  order(col, opts = {}) {
    this._order.push({ column: col, ascending: opts.ascending !== false });
    return this;
  }
  limit(n) { this._limit = n; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }

  // --- Execute ---
  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }
  catch(reject) { return this._execute().catch(reject); }

  async _execute() {
    const payload = {
      table:       this._table,
      op:          this._op,
      filters:     Object.keys(this._filters).length ? this._filters : undefined,
      data:        this._data,
      // Send select if: explicitly called (for insert/update return), or if non-default columns
      select:      (this._selectCalled || this._select !== '*') ? this._select : undefined,
      order:       this._order.length ? this._order : undefined,
      limit:       this._limit,
      single:      this._single || undefined,
      maybeSingle: this._maybeSingle || undefined,
      count:       this._count  || undefined,
      head:        this._head   || undefined,
      upsertOpts:  this._upsertOpts || undefined,
    };

    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // ── HTTP-level errors (403 Forbidden, 500 Internal Server Error, etc.) ──
      if (!res.ok) {
        const msg = `db-proxy HTTP ${res.status} on ${this._op} '${this._table}'`;
        _reportDbError(msg, { table: this._table, op: this._op, status: res.status });
        return { data: null, error: { message: msg } };
      }

      const json = await res.json();

      // ── Application-level errors ("table not allowed", RLS violations, etc.) ──
      if (json.error) {
        const msg = `db-proxy error on ${this._op} '${this._table}': ${json.error}`;
        _reportDbError(msg, { table: this._table, op: this._op, error: json.error });
        return { data: null, error: { message: json.error } };
      }

      // ── maybeSingle: return first row or null — never an error for empty results ──
      if (this._maybeSingle) {
        const rows = Array.isArray(json.data) ? json.data : [];
        return { data: rows[0] ?? null, error: null };
      }

      return { data: json.data, error: null, count: json.count ?? null };
    } catch (e) {
      // ── Network-level errors (offline, CORS failure, etc.) ──
      const msg = `db-proxy network error on ${this._op} '${this._table}': ${e}`;
      _reportDbError(msg, { table: this._table, op: this._op, error: String(e) });
      return { data: null, error: { message: String(e) } };
    }
  }
}

// Supabase-compatible interface
export const supabase = {
  from: (table) => new ProxyQueryBuilder(table),
  // Storage passthrough (still uses anon key — storage isn't sensitive DB data)
  storage: {
    from: (bucket) => ({
      upload: async (path, file, opts) => {
        const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4c3V6Z3BudnRlcHN5aGtlemluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3Nzc1MDAsImV4cCI6MjA4NzM1MzUwMH0.oKtpiH63heyK-wJ87ZRvkhUzRqy6NT6Z2XWF1xjbtxA';
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        const sb = createClient('https://kxsuzgpnvtepsyhkezin.supabase.co', ANON);
        return sb.storage.from(bucket).upload(path, file, opts);
      },
      getPublicUrl: (path) => ({
        data: { publicUrl: `https://kxsuzgpnvtepsyhkezin.supabase.co/storage/v1/object/public/${bucket}/${path}` }
      }),
    })
  }
};
