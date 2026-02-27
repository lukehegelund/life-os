// db-proxy — LifeOS secure database proxy
// All browser requests go through here instead of hitting Supabase directly
// This function runs with service_role, so RLS is bypassed intentionally here
// Security is enforced by the allow-list below

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

// Tables the browser is allowed to write (INSERT/UPDATE/DELETE)
const WRITABLE_TABLES = new Set([
  'attendance', 'calendar_events', 'class_overview_notes', 'claude_notifications',
  'claude_projects', 'claude_tasks', 'daily_sessions', 'exercise_log', 'food_log',
  'gold_transactions', 'grades', 'health_notes', 'language_errors', 'lesson_plans',
  'lifeos_feedback', 'pages_completed', 'parent_contacts', 'parent_crm',
  'participation_scores', 'reminders', 'smart_reports', 'spelling_tests',
  'srs_reviews', 'student_notes', 'student_pages', 'tasks', 'time_blocks',
  'tov_clients', 'tov_contracts', 'tov_expenses', 'tov_inquiries', 'tov_payments',
  'tov_transfers', 'vocab_words'
])

// Tables that are READ-ONLY (never allow writes from browser)
// students, classes, class_enrollments — structural data managed by Claude only

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://lukehegelund.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ProxyRequest {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  filters?: Record<string, any>   // e.g. { eq: { id: '123' }, gte: { date: '2026-01-01' } }
  data?: Record<string, any> | Record<string, any>[]
  select?: string                  // columns to select, default '*'
  order?: { column: string; ascending?: boolean }[]
  limit?: number
  single?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body: ProxyRequest = await req.json()
    const { table, op, filters, data, select, order, limit, single } = body

    // Validate table
    if (!READABLE_TABLES.has(table)) {
      return new Response(JSON.stringify({ error: `Table '${table}' not allowed` }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate write permission
    if (['insert', 'update', 'delete', 'upsert'].includes(op) && !WRITABLE_TABLES.has(table)) {
      return new Response(JSON.stringify({ error: `Write to '${table}' not allowed` }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

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
