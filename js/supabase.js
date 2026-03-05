// Life OS — Database Client
// Calls Supabase PostgREST directly using the anon key.
// RLS is disabled on this project (single-user personal app), so the anon key
// has full read/write access to all tables.

const SUPABASE_URL = 'https://kxsuzgpnvtepsyhkezin.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4c3V6Z3BudnRlcHN5aGtlemluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3Nzc1MDAsImV4cCI6MjA4NzM1MzUwMH0.oKtpiH63heyK-wJ87ZRvkhUzRqy6NT6Z2XWF1xjbtxA';

// ── Error reporter ────────────────────────────────────────────────────────────
const PAGE = window.location.pathname.split('/').pop() || 'index.html';
const _recentDbErrors = new Map();

function _reportDbError(message, context) {
  if (context?.table === 'console_errors') return;
  const now = Date.now();
  if (_recentDbErrors.has(message) && now - _recentDbErrors.get(message) < 10_000) return;
  _recentDbErrors.set(message, now);

  const url = `${SUPABASE_URL}/rest/v1/console_errors`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      page: PAGE,
      message: String(message).slice(0, 500),
      stack: context ? JSON.stringify(context).slice(0, 2000) : null,
      error_type: 'supabase_error',
      status: 'open',
    }),
  }).catch(() => {});
}

// ── Query builder that talks directly to PostgREST ───────────────────────────
class QueryBuilder {
  constructor(table) {
    this._table = table;
    this._op = 'select';
    this._filters = [];
    this._data = null;
    this._select = '*';
    this._order = [];
    this._limit = null;
    this._single = false;
    this._maybeSingle = false;
    this._count = null;
    this._head = false;
    this._upsertOpts = null;
  }

  select(cols = '*', opts = {}) {
    this._select = cols;
    this._op = 'select';
    if (opts?.count) this._count = opts.count;
    if (opts?.head)  this._head  = true;
    return this;
  }
  insert(data) { this._op = 'insert'; this._data = data; return this; }
  update(data) { this._op = 'update'; this._data = data; return this; }
  delete()     { this._op = 'delete'; return this; }
  upsert(data, opts = {}) {
    this._op = 'upsert'; this._data = data;
    if (opts && Object.keys(opts).length) this._upsertOpts = opts;
    return this;
  }

  // Filters
  eq(col, val)  { this._filters.push({ method: 'eq',  col, val }); return this; }
  neq(col, val) { this._filters.push({ method: 'neq', col, val }); return this; }
  gte(col, val) { this._filters.push({ method: 'gte', col, val }); return this; }
  lte(col, val) { this._filters.push({ method: 'lte', col, val }); return this; }
  gt(col, val)  { this._filters.push({ method: 'gt',  col, val }); return this; }
  lt(col, val)  { this._filters.push({ method: 'lt',  col, val }); return this; }
  like(col, val)   { this._filters.push({ method: 'like',  col, val }); return this; }
  ilike(col, val)  { this._filters.push({ method: 'ilike', col, val }); return this; }
  is(col, val)     { this._filters.push({ method: 'is',    col, val }); return this; }
  in(col, vals)    { this._filters.push({ method: 'in',    col, val: vals }); return this; }
  contains(col, val) { this._filters.push({ method: 'cs', col, val }); return this; }
  overlaps(col, val) { this._filters.push({ method: 'ov', col, val }); return this; }
  not(col, op, val)  { this._filters.push({ method: 'not', col, op, val }); return this; }
  or(query)      { this._filters.push({ method: 'or', val: query }); return this; }

  order(col, opts = {}) {
    this._order.push({ column: col, ascending: opts.ascending !== false });
    return this;
  }
  limit(n) { this._limit = n; return this; }
  single()      { this._single = true; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }

  then(resolve, reject) { return this._execute().then(resolve, reject); }
  catch(reject) { return this._execute().catch(reject); }

  async _execute() {
    const table = this._table;
    const op = this._op;
    const baseUrl = `${SUPABASE_URL}/rest/v1/${table}`;

    const headers = {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    };

    // Build query string
    const params = new URLSearchParams();

    // SELECT columns
    if (op === 'select' || op === 'insert') {
      params.set('select', this._select);
    }

    // Filters → PostgREST query params
    for (const f of this._filters) {
      if (f.method === 'or') {
        params.set('or', `(${f.val})`);
      } else if (f.method === 'not') {
        params.set(f.col, `not.${f.op}.${f.val}`);
      } else if (f.method === 'in') {
        params.set(f.col, `in.(${Array.isArray(f.val) ? f.val.join(',') : f.val})`);
      } else if (f.method === 'is') {
        params.set(f.col, `is.${f.val}`);
      } else if (f.method === 'cs') {
        params.set(f.col, `cs.{${Array.isArray(f.val) ? f.val.join(',') : f.val}}`);
      } else {
        params.set(f.col, `${f.method}.${f.val}`);
      }
    }

    // Order
    if (this._order.length) {
      params.set('order', this._order.map(o => `${o.column}.${o.ascending ? 'asc' : 'desc'}`).join(','));
    }

    // Limit
    if (this._limit) params.set('limit', String(this._limit));

    const url = `${baseUrl}?${params.toString()}`;

    // Prefer header
    const prefer = [];
    if (op === 'insert' || op === 'upsert') prefer.push('return=representation');
    if (op === 'upsert') prefer.push('resolution=merge-duplicates');
    if (this._count) prefer.push(`count=${this._count}`);
    if (this._single) { headers['Accept'] = 'application/vnd.pgrst.object+json'; }
    if (prefer.length) headers['Prefer'] = prefer.join(',');

    let method = 'GET';
    let body = undefined;

    if (op === 'select') {
      method = 'GET';
      if (this._head) method = 'HEAD';
    } else if (op === 'insert') {
      method = 'POST';
      body = JSON.stringify(this._data);
    } else if (op === 'update') {
      method = 'PATCH';
      body = JSON.stringify(this._data);
      headers['Prefer'] = 'return=representation';
    } else if (op === 'delete') {
      method = 'DELETE';
      headers['Prefer'] = 'return=representation';
    } else if (op === 'upsert') {
      method = 'POST';
      body = JSON.stringify(this._data);
    }

    try {
      const res = await fetch(url, { method, headers, body });

      if (!res.ok) {
        let errMsg = `PostgREST ${res.status} on ${op} '${table}'`;
        try { const j = await res.json(); errMsg = j.message || j.hint || errMsg; } catch {}
        _reportDbError(errMsg, { table, op, status: res.status });
        return { data: null, error: { message: errMsg } };
      }

      if (method === 'HEAD' || res.status === 204) {
        const count = res.headers.get('Content-Range')?.split('/')[1];
        return { data: null, error: null, count: count ? parseInt(count) : null };
      }

      const json = await res.json();

      // maybeSingle
      if (this._maybeSingle) {
        const rows = Array.isArray(json) ? json : [json];
        return { data: rows[0] ?? null, error: null };
      }

      // Count from Content-Range header
      let count = null;
      const cr = res.headers.get('Content-Range');
      if (cr) { const parts = cr.split('/'); count = parts[1] ? parseInt(parts[1]) : null; }

      return { data: json, error: null, count };
    } catch (e) {
      const msg = `Network error on ${op} '${table}': ${e}`;
      _reportDbError(msg, { table, op, error: String(e) });
      return { data: null, error: { message: String(e) } };
    }
  }
}

// Supabase-compatible interface
export const supabase = {
  from: (table) => new QueryBuilder(table),
  storage: {
    from: (bucket) => ({
      upload: async (path, file, opts) => {
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        const sb = createClient(SUPABASE_URL, ANON_KEY);
        return sb.storage.from(bucket).upload(path, file, opts);
      },
      getPublicUrl: (path) => ({
        data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` }
      }),
    })
  }
};
