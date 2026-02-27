// db-proxy — LifeOS secure database proxy
// All browser requests go through here instead of hitting Supabase directly
// This function runs with service_role, so RLS is bypassed intentionally here
// Security is enforced by the allow-lists and validation rules below

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ── Fase 1: Table-level allow-lists ───────────────────────────────────────────

// Tables the browser is allowed to read (SELECT)
const READABLE_TABLES = new Set([
  'attendance', 'calendar_events', 'class_enrollments', 'class_overview_notes',
  'classes', 'claude_notifications', 'claude_projects', 'claude_tasks',
  'daily_sessions', 'events', 'exercise_log', 'food_log', 'gold_transactions',
  'grades', 'health_notes', 'language_errors', 'lesson_plans', 'lifeos_feedback',
  'pages_completed', 'parent_contacts', 'parent_crm', 'participation_scores',
  'reminders', 'smart_reports', 'spelling_tests', 'srs_reviews', 'student_notes',
  'student_pages', 'students', 'tasks', 'time_blocks', 'tov_clients',
  'tov_contracts', 'tov_expenses', 'tov_inquiries', 'tov_payments',
  'tov_transfers', 'vocab_words'
])

// Tables the browser is allowed to INSERT or UPDATE
const INSERT_UPDATE_TABLES = new Set([
  'attendance', 'calendar_events', 'class_overview_notes', 'claude_notifications',
  'claude_projects', 'claude_tasks', 'daily_sessions', 'exercise_log', 'food_log',
  'gold_transactions', 'grades', 'health_notes', 'language_errors', 'lesson_plans',
  'lifeos_feedback', 'pages_completed', 'parent_contacts', 'parent_crm',
  'participation_scores', 'reminders', 'smart_reports', 'spelling_tests',
  'srs_reviews', 'student_notes', 'student_pages', 'tasks', 'time_blocks',
  'tov_clients', 'tov_contracts', 'tov_expenses', 'tov_inquiries', 'tov_payments',
  'tov_transfers', 'vocab_words'
])

// ── Fase 2: Granular DELETE allow-list ────────────────────────────────────────
// Only low-risk, user-generated content tables allow DELETE from the browser.
// Financial records, contracts, reports, student data — DELETE blocked (use archive pattern).
const DELETABLE_TABLES = new Set([
  'attendance', 'calendar_events', 'class_overview_notes', 'claude_notifications',
  'claude_tasks', 'exercise_log', 'food_log', 'gold_transactions', 'grades',
  'health_notes', 'language_errors', 'lesson_plans', 'lifeos_feedback',
  'pages_completed', 'parent_contacts', 'participation_scores', 'reminders',
  'spelling_tests', 'srs_reviews', 'student_notes', 'student_pages',
  'tasks', 'time_blocks', 'vocab_words'
])

// ── Fase 2: Tables that REQUIRE a filter on UPDATE/DELETE ─────────────────────
// Prevents accidental bulk mutations. These tables require at least one filter.
const REQUIRE_FILTER_FOR_MUTATIONS = new Set([
  'claude_projects', 'tov_clients', 'tov_contracts', 'tov_payments',
  'tov_expenses', 'tov_inquiries', 'tov_transfers', 'parent_crm',
  'students', 'smart_reports', 'daily_sessions', 'attendance',
  'tasks', 'food_log', 'exercise_log', 'reminders'
])

// ── Fase 2: Protected fields that cannot be written from the browser ──────────
// Keyed by table name → Set of field names
const PROTECTED_FIELDS: Record<string, Set<string>> = {
  tov_contracts: new Set(['signed_date', 'contract_value_override']),
  tov_payments:  new Set(['amount', 'payment_method', 'confirmed_at']),
  students:      new Set(['id', 'created_at']),
  classes:       new Set(['id', 'created_at']),
  smart_reports: new Set(['id', 'created_at', 'generated_by']),
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://lukehegelund.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ProxyRequest {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  filters?: Record<string, any>
  data?: Record<string, any> | Record<string, any>[]
  select?: string
  order?: { column: string; ascending?: boolean }[]
  limit?: number
  single?: boolean
}

function err(msg: string, status = 403) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function hasFilters(filters?: Record<string, any>): boolean {
  if (!filters) return false
  return Object.keys(filters).length > 0
}

function checkProtectedFields(table: string, data: any): string | null {
  const protected_ = PROTECTED_FIELDS[table]
  if (!protected_) return null
  const rows = Array.isArray(data) ? data : [data]
  for (const row of rows) {
    if (row && typeof row === 'object') {
      for (const field of Object.keys(row)) {
        if (protected_.has(field)) {
          return `Field '${field}' on table '${table}' is protected and cannot be written from the browser`
        }
      }
    }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body: ProxyRequest = await req.json()
    const { table, op, filters, data, select, order, limit, single } = body

    // ── Fase 1: Table-level checks ────────────────────────────────────────────

    if (!READABLE_TABLES.has(table)) {
      return err(`Table '${table}' not allowed`)
    }

    if (['insert', 'update', 'upsert'].includes(op) && !INSERT_UPDATE_TABLES.has(table)) {
      return err(`Write to '${table}' not allowed`)
    }

    // ── Fase 2: Granular operation checks ─────────────────────────────────────

    // DELETE: only allowed on explicitly deletable tables
    if (op === 'delete' && !DELETABLE_TABLES.has(table)) {
      return err(`DELETE on '${table}' not allowed from browser — use archive pattern instead`)
    }

    // UPDATE/DELETE: require at least one filter on sensitive tables
    if (['update', 'delete'].includes(op) && REQUIRE_FILTER_FOR_MUTATIONS.has(table)) {
      if (!hasFilters(filters)) {
        return err(`UPDATE/DELETE on '${table}' requires at least one filter (prevents bulk mutations)`)
      }
    }

    // Validate data is an object or array (not a string/primitive)
    if (data !== undefined && data !== null) {
      if (typeof data !== 'object') {
        return err(`Invalid data payload — must be an object or array`, 400)
      }
    }

    // Protected field check on INSERT/UPDATE/UPSERT
    if (['insert', 'update', 'upsert'].includes(op) && data) {
      const fieldError = checkProtectedFields(table, data)
      if (fieldError) return err(fieldError)
    }

    // ── Execute query ─────────────────────────────────────────────────────────

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    let query: any

    if (op === 'select') {
      query = sb.from(table).select(select || '*')
    } else if (op === 'insert') {
      query = sb.from(table).insert(data)
      if (select) query = query.select(select)
    } else if (op === 'update') {
      query = sb.from(table).update(data)
    } else if (op === 'delete') {
      query = sb.from(table).delete()
    } else if (op === 'upsert') {
      query = sb.from(table).upsert(data)
    }

    // Apply filters
    if (filters) {
      for (const [method, args] of Object.entries(filters)) {
        if (typeof args === 'object' && !Array.isArray(args)) {
          for (const [col, val] of Object.entries(args as Record<string, any>)) {
            query = query[method](col, val)
          }
        }
      }
    }

    // Apply ordering
    if (order) {
      for (const o of order) {
        query = query.order(o.column, { ascending: o.ascending ?? true })
      }
    }

    // Apply limit
    if (limit) query = query.limit(limit)

    // Single row
    if (single) query = query.single()

    const { data: result, error } = await query

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ data: result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
