// Life OS — TOV Client Profile
import { supabase } from './supabase.js';
import { qp, fmtDate, fmtDateFull, fmtMoney, badge, toast, showEmpty } from './utils.js';

const clientId = qp('id');
if (!clientId) { window.location.href = 'tov.html'; }

async function load() {
  const res = await supabase.from('tov_clients').select('*').eq('id', clientId).single();
  const c = res.data;
  if (!c) return;

  document.title = c.name + ' — Life OS';
  document.getElementById('client-name').textContent = c.name;

  const contractColor = c.contract_status === 'Signed' ? 'green' : c.contract_status === 'Sent' ? 'blue' : 'gold';
  const balance = (c.total_contracted || 0) - (c.total_paid || 0);

  document.getElementById('client-header').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-size:22px;font-weight:700">${c.name}</div>
          <div style="color:var(--gray-400);font-size:13px;margin-top:2px">
            ${c.wedding_date ? '💍 ' + fmtDateFull(c.wedding_date) : 'No wedding date'} · ${c.package || '—'}
          </div>
          ${c.venue ? `<div style="font-size:13px;color:var(--gray-600);margin-top:4px">📍 ${c.venue}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:24px;font-weight:700;color:${balance > 0 ? 'var(--red)' : 'var(--green)'}">
            ${balance > 0 ? fmtMoney(balance) + ' owed' : 'Paid in full'}
          </div>
          <div style="font-size:13px;color:var(--gray-400)">${fmtMoney(c.total_paid)} / ${fmtMoney(c.total_contracted)}</div>
          <div style="margin-top:4px">${badge(c.contract_status || 'None', contractColor)}</div>
        </div>
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-100);font-size:13px;color:var(--gray-600)">
        ${c.email ? `<div>✉️ <a href="mailto:${c.email}">${c.email}</a></div>` : ''}
        ${c.phone ? `<div>📞 <a href="tel:${c.phone}">${c.phone}</a></div>` : ''}
        ${c.source ? `<div style="margin-top:4px">Source: ${badge(c.source, 'blue')}</div>` : ''}
      </div>
      ${c.notes ? `<div style="margin-top:10px;font-size:13px;padding-top:10px;border-top:1px solid var(--gray-100)">${c.notes}</div>` : ''}
    </div>`;

  await Promise.all([loadPayments(c), loadContracts(c), loadInquiry(c)]);
  setupPaymentForm(c);
}

async function loadPayments(c) {
  const el = document.getElementById('payments-list');
  const res = await supabase.from('tov_payments').select('*').eq('client_id', clientId).order('date', { ascending: false });
  const payments = res.data || [];
  if (!payments.length) { showEmpty(el, '💳', 'No payments recorded'); return; }
  el.innerHTML = payments.map(p => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${fmtMoney(p.amount)}</div>
        <div class="list-item-sub">${fmtDate(p.date)} · ${p.type || '—'} · ${p.method || '—'}${p.account ? ' → ' + p.account : ''}</div>
        ${p.tithe_allocated > 0 ? `<div style="font-size:12px;color:var(--green)">Tithe: ${fmtMoney(p.tithe_allocated)}${p.tithe_destination ? ' → ' + p.tithe_destination : ''}</div>` : ''}
      </div>
    </div>`).join('');
}

async function loadContracts(c) {
  const el = document.getElementById('contracts-list');
  const res = await supabase.from('tov_contracts').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  const contracts = res.data || [];
  if (!contracts.length) { el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No contracts on file</div>'; return; }
  const colors = { Draft: 'gray', Sent: 'blue', Signed: 'green', Void: 'red' };
  el.innerHTML = contracts.map(ct => `
    <div class="list-item">
      <div class="list-item-left">
        <div class="list-item-name">${ct.file_name || 'Contract'}</div>
        <div class="list-item-sub">${ct.sent_date ? 'Sent: ' + fmtDate(ct.sent_date) : ''}${ct.signed_date ? ' · Signed: ' + fmtDate(ct.signed_date) : ''}</div>
      </div>
      <div class="list-item-right">${badge(ct.status, colors[ct.status] || 'gray')}</div>
    </div>`).join('');
}

async function loadInquiry(c) {
  const el = document.getElementById('inquiry-notes');
  const res = await supabase.from('tov_inquiries').select('*').eq('client_id', clientId).order('received_at', { ascending: false });
  const inquiries = res.data || [];
  if (!inquiries.length) { el.innerHTML = '<div style="color:var(--gray-400);font-size:14px">No inquiry records</div>'; return; }
  el.innerHTML = inquiries.map(i => `
    <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:4px">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
        ${badge(i.status, i.status === 'Booked' ? 'green' : 'blue')}
        <span style="font-size:12px;color:var(--gray-400)">${i.received_at ? fmtDate(i.received_at) : ''}</span>
      </div>
      ${i.message ? `<div style="font-size:13px;color:var(--gray-600)">${i.message}</div>` : ''}
      ${i.notes ? `<div style="font-size:13px">${i.notes}</div>` : ''}
    </div>`).join('');
}

function setupPaymentForm(c) {
  window.showPaymentForm = () => { document.getElementById('payment-modal').style.display = 'flex'; };
  window.closePaymentModal = () => { document.getElementById('payment-modal').style.display = 'none'; };
  window.submitPayment = async () => {
    const amount = parseFloat(document.getElementById('pay-amount').value);
    const type = document.getElementById('pay-type').value;
    const method = document.getElementById('pay-method').value.trim();
    const date = document.getElementById('pay-date').value;
    const tithe = parseFloat(document.getElementById('pay-tithe').value) || 0;
    const dest = document.getElementById('pay-tithe-dest').value.trim();
    if (isNaN(amount) || !date) { toast('Fill in amount and date', 'error'); return; }

    const { error } = await supabase.from('tov_payments').insert({
      client_id: Number(clientId), amount, type, method, date, tithe_allocated: tithe, tithe_destination: dest || null
    });
    if (error) { toast('Error: ' + error.message, 'error'); return; }

    // Update total_paid on client
    const newPaid = (c.total_paid || 0) + amount;
    await supabase.from('tov_clients').update({ total_paid: newPaid }).eq('id', clientId);

    toast('Payment recorded!', 'success');
    window.closePaymentModal();
    load();
  };
}

load();
