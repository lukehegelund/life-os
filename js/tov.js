// Life OS — TOV Overview
import { supabase } from './supabase.js';
import { today, fmtDate, fmtMoney, badge, showSpinner, showEmpty, toast } from './utils.js';
import { startPolling } from './polling.js';

const T = today();
const thisYear = new Date().getFullYear();

async function load() {
  await Promise.all([loadFinancials(), loadClients(), loadInquiries()]);
}

async function loadFinancials() {
  const el = document.getElementById('financials');
  const yearStart = `${thisYear}-01-01`;

  const [paymentsRes, expensesRes] = await Promise.all([
    supabase.from('tov_payments').select('amount, tithe_allocated').gte('date', yearStart),
    supabase.from('tov_expenses').select('amount').eq('fiscal_year', thisYear)
  ]);

  const revenue = (paymentsRes.data || []).reduce((s, r) => s + (r.amount || 0), 0);
  const expenses = (expensesRes.data || []).reduce((s, r) => s + (r.amount || 0), 0);
  const tithe = (paymentsRes.data || []).reduce((s, r) => s + (r.tithe_allocated || 0), 0);
  const net = revenue - expenses;

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">Revenue YTD</div>
        <div class="value" style="color:var(--green)">${fmtMoney(revenue)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Expenses YTD</div>
        <div class="value" style="color:var(--red)">${fmtMoney(expenses)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Net Profit</div>
        <div class="value" style="color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoney(net)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Tithe YTD</div>
        <div class="value" style="color:var(--gold)">${fmtMoney(tithe)}</div>
      </div>
    </div>`;
}

async function loadClients() {
  const el = document.getElementById('clients-list');
  showSpinner(el);

  const res = await supabase.from('tov_clients')
    .select('*')
    .not('contract_status', 'eq', 'Void')
    .order('wedding_date');

  const clients = res.data || [];
  if (!clients.length) { showEmpty(el, '💍', 'No active clients'); return; }

  const upcoming = clients.filter(c => c.wedding_date >= T);
  const past = clients.filter(c => c.wedding_date && c.wedding_date < T);

  function clientRow(c) {
    const contractColor = c.contract_status === 'Signed' ? 'green' : c.contract_status === 'Sent' ? 'blue' : 'gold';
    const balance = (c.total_contracted || 0) - (c.total_paid || 0);
    return `
      <a href="tov-client.html?id=${c.id}" style="text-decoration:none;color:inherit">
        <div class="list-item">
          <div class="list-item-left">
            <div class="list-item-name">${c.name}</div>
            <div class="list-item-sub">${c.wedding_date ? fmtDate(c.wedding_date) : 'No date'} · ${c.package || '—'}</div>
          </div>
          <div class="list-item-right">
            <div style="text-align:right">
              ${balance > 0 ? `<div style="font-weight:700;color:var(--red);font-size:14px">Owes ${fmtMoney(balance)}</div>` : '<div style="color:var(--green);font-size:14px">Paid ✓</div>'}
              <div>${badge(c.contract_status || 'None', contractColor)}</div>
            </div>
          </div>
        </div>
      </a>`;
  }

  el.innerHTML = '';
  if (upcoming.length) {
    el.innerHTML += `<div class="section-label">Upcoming</div>` + upcoming.map(clientRow).join('');
  }
  if (past.length) {
    el.innerHTML += `<div class="section-label" style="margin-top:16px">Past</div>` + past.map(clientRow).join('');
  }
}

async function loadInquiries() {
  const el = document.getElementById('inquiries-list');
  const res = await supabase.from('tov_inquiries')
    .select('*')
    .in('status', ['New', 'Responded'])
    .order('received_at', { ascending: false });
  const inquiries = res.data || [];
  if (!inquiries.length) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No active inquiries</div>';
    return;
  }
  el.innerHTML = inquiries.map(i => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${i.name}</div>
        <div class="list-item-sub">${i.wedding_date ? fmtDate(i.wedding_date) : 'No date'} · ${i.venue || '—'} · ${i.source || '—'}</div>
      </div>
      <div class="list-item-right">
        ${badge(i.status, i.status === 'New' ? 'red' : 'gold')}
      </div>
    </div>`).join('');
}

// Quick add expense modal
window.showExpenseForm = () => {
  const today_str = T;
  const modal = document.getElementById('expense-modal');
  modal.style.display = 'flex';
  document.getElementById('exp-date').value = today_str;
};
window.closeExpenseModal = () => { document.getElementById('expense-modal').style.display = 'none'; };
window.submitExpense = async () => {
  const desc = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value);
  const cat = document.getElementById('exp-cat').value;
  const date = document.getElementById('exp-date').value;
  if (!desc || isNaN(amount) || !date) { toast('Fill in all fields', 'error'); return; }
  const { error } = await supabase.from('tov_expenses').insert({ date, description: desc, amount, category: cat, fiscal_year: new Date(date).getFullYear() });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Expense logged!', 'success');
  window.closeExpenseModal();
  loadFinancials();
};

load();
startPolling(load, 10000);
