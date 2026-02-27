// Life OS — Secure Database Client
// All requests are routed through the db-proxy Edge Function (service_role)
// The anon key below has NO table access (RLS blocks everything)

const PROXY_URL = 'https://kxsuzgpnvtepsyhkezin.supabase.co/functions/v1/db-proxy';

// Minimal query builder that mirrors the supabase-js chained API
// but sends everything to the secure proxy instead of directly to PostgREST
class ProxyQueryBuilder {
  constructor(table) {
    this._table = table;
    this._op = 'select';
    this._filters = {};
    this._data = null;
    this._select = '*';
    this._order = [];
    this._limit = null;
    this._single = false;
  }

  // --- Operation setters ---
  select(cols = '*') { this._select = cols; this._op = 'select'; return this; }
  insert(data) { this._op = 'insert'; this._data = data; return this; }
  update(data) { this._op = 'update'; this._data = data; return this; }
  delete() { this._op = 'delete'; return this; }
  upsert(data) { this._op = 'upsert'; this._data = data; return this; }

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

  // --- Modifiers ---
  order(col, opts = {}) {
    this._order.push({ column: col, ascending: opts.ascending !== false });
    return this;
  }
  limit(n) { this._limit = n; return this; }
  single() { this._single = true; return this; }

  // --- Execute ---
  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }
  catch(reject) { return this._execute().catch(reject); }

  async _execute() {
    const payload = {
      table:   this._table,
      op:      this._op,
      filters: Object.keys(this._filters).length ? this._filters : undefined,
      data:    this._data,
      select:  this._select !== '*' ? this._select : undefined,
      order:   this._order.length ? this._order : undefined,
      limit:   this._limit,
      single:  this._single || undefined,
    };

    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.error) return { data: null, error: { message: json.error } };
      return { data: json.data, error: null };
    } catch (e) {
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
