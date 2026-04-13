import { useState } from 'react';
import { fmtTotal, fmtDate, num, uid, type CashTransaction } from '@/lib/tracker-helpers';
import '@/styles/tracker.css';

interface CashBoxManagerProps {
  currentCash: number;
  currentOwner: string;
  cashHistory: CashTransaction[];
  onSave: (newCash: number, owner: string, history: CashTransaction[]) => void;
  onClose: () => void;
}

export function CashBoxManager({ currentCash, currentOwner, cashHistory, onSave, onClose }: CashBoxManagerProps) {
  const [tab, setTab] = useState<'add' | 'deduct' | 'history'>('add');
  const [amount, setAmount] = useState('');
  const [owner, setOwner] = useState(currentOwner);
  const [bankAccount, setBankAccount] = useState('');
  const [note, setNote] = useState('');

  const amtNum = num(parseFloat(amount) || 0, 0);

  const handleAdd = () => {
    if (amtNum <= 0) return;
    const newBalance = currentCash + amtNum;
    const tx: CashTransaction = {
      id: uid(), ts: Date.now(), type: 'deposit', amount: amtNum,
      balanceAfter: newBalance, owner: owner.trim(), bankAccount: bankAccount.trim(), note: note.trim(),
    };
    onSave(newBalance, owner.trim(), [...cashHistory, tx]);
    onClose();
  };

  const handleDeduct = () => {
    if (amtNum <= 0 || amtNum > currentCash) return;
    const newBalance = currentCash - amtNum;
    const tx: CashTransaction = {
      id: uid(), ts: Date.now(), type: 'withdraw', amount: amtNum,
      balanceAfter: newBalance, owner: owner.trim(), bankAccount: bankAccount.trim(), note: note.trim(),
    };
    onSave(newBalance, owner.trim(), [...cashHistory, tx]);
    onClose();
  };

  const handleClear = () => {
    const tx: CashTransaction = {
      id: uid(), ts: Date.now(), type: 'withdraw', amount: currentCash,
      balanceAfter: 0, owner: owner.trim(), bankAccount: '', note: 'Cash cleared',
    };
    onSave(0, owner.trim(), [...cashHistory, tx]);
    onClose();
  };

  const sortedHistory = [...cashHistory].sort((a, b) => b.ts - a.ts);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 16px', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
    borderRadius: 6,
    background: active ? 'var(--brand)' : 'transparent',
    color: active ? '#fff' : 'var(--muted)',
  });

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{
          position: 'relative', zIndex: 1, background: 'var(--panel2)', border: '1px solid var(--line)',
          borderRadius: 10, padding: '20px 24px', width: '100%', maxWidth: 540,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)', maxHeight: '85vh', overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>💰 Cash Box Manager</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* Current balance — styled as a non-interactive banner */}
        <div style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--good) 12%, transparent), color-mix(in srgb, var(--good) 5%, transparent))',
          border: '1px solid color-mix(in srgb, var(--good) 25%, transparent)',
          borderRadius: 8, padding: '14px 18px', marginBottom: 14,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--good)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>💰 Available Balance</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--good)', fontFamily: 'var(--mono, monospace)', lineHeight: 1 }}>
              {fmtTotal(currentCash)} <span style={{ fontSize: 13, fontWeight: 600 }}>QAR</span>
            </div>
          </div>
          {currentOwner && (
            <div style={{ textAlign: 'right', padding: '6px 12px', background: 'color-mix(in srgb, var(--good) 8%, transparent)', borderRadius: 6 }}>
              <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Owner</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{currentOwner}</div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--cardBg)', borderRadius: 8, padding: 3 }}>
          <button style={tabStyle(tab === 'add')} onClick={() => setTab('add')}>➕ Add Cash</button>
          <button style={tabStyle(tab === 'deduct')} onClick={() => setTab('deduct')}>➖ Deduct Cash</button>
          <button style={tabStyle(tab === 'history')} onClick={() => setTab('history')}>📋 History ({cashHistory.length})</button>
        </div>

        {/* Add / Deduct Form */}
        {(tab === 'add' || tab === 'deduct') && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--good)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  {tab === 'add' ? 'Amount to Add (QAR)' : 'Amount to Deduct (QAR)'}
                </label>
                <input
                  type="number" placeholder="e.g. 20000" value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', background: 'var(--cardBg)', border: '1px solid var(--line)',
                    borderRadius: 6, color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono, monospace)', outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--good)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  {tab === 'add' ? 'Balance After Add' : 'Balance After Deduct'}
                </label>
                <input
                  type="text" readOnly
                  value={fmtTotal(tab === 'add' ? currentCash + amtNum : Math.max(0, currentCash - amtNum))}
                  style={{
                    width: '100%', padding: '8px 12px', background: 'var(--cardBg)', border: '1px solid var(--line)',
                    borderRadius: 6, color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono, monospace)', outline: 'none', opacity: 0.8,
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--good)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Owner / Source
                </label>
                <input
                  placeholder="e.g. Ahmad" value={owner}
                  onChange={e => setOwner(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', background: 'var(--cardBg)', border: '1px solid var(--line)',
                    borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--good)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Bank Account
                </label>
                <input
                  placeholder="e.g. QNB - 1234" value={bankAccount}
                  onChange={e => setBankAccount(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', background: 'var(--cardBg)', border: '1px solid var(--line)',
                    borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none',
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--good)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Note (optional)
              </label>
              <input
                placeholder="Reason for this transaction" value={note}
                onChange={e => setNote(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', background: 'var(--cardBg)', border: '1px solid var(--line)',
                  borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none',
                }}
              />
            </div>

            {tab === 'deduct' && amtNum > currentCash && (
              <div style={{ fontSize: 11, color: 'var(--bad)', marginBottom: 8, fontWeight: 600 }}>
                ⚠ Cannot deduct more than available balance ({fmtTotal(currentCash)} QAR)
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', cursor: 'pointer' }}>
                Cancel
              </button>
              {tab === 'add' && (
                <>
                  <button onClick={handleClear} style={{ padding: '8px 18px', fontSize: 12, fontWeight: 700, background: 'transparent', border: '1px solid var(--bad)', borderRadius: 6, color: 'var(--bad)', cursor: 'pointer' }}>
                    Clear All
                  </button>
                  <button onClick={handleAdd} disabled={amtNum <= 0} style={{ padding: '8px 18px', fontSize: 12, fontWeight: 700, background: 'var(--good)', border: 'none', borderRadius: 6, color: '#fff', cursor: amtNum > 0 ? 'pointer' : 'not-allowed', opacity: amtNum > 0 ? 1 : 0.5 }}>
                    Add Cash
                  </button>
                </>
              )}
              {tab === 'deduct' && (
                <button onClick={handleDeduct} disabled={amtNum <= 0 || amtNum > currentCash} style={{ padding: '8px 18px', fontSize: 12, fontWeight: 700, background: 'var(--bad)', border: 'none', borderRadius: 6, color: '#fff', cursor: amtNum > 0 && amtNum <= currentCash ? 'pointer' : 'not-allowed', opacity: amtNum > 0 && amtNum <= currentCash ? 1 : 0.5 }}>
                  Deduct Cash
                </button>
              )}
            </div>
          </div>
        )}

        {/* History Tab */}
        {tab === 'history' && (
          <div>
            {sortedHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 12 }}>
                No cash transactions yet
              </div>
            ) : (
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Date</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Type</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600 }}>Amount</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600 }}>Balance</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Owner / Bank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHistory.map(tx => {
                      const isDeposit = tx.type === 'deposit';
                      const isBatch = tx.type === 'batch_purchase';
                      const typeLabel = isDeposit ? '➕ Deposit' : isBatch ? '📦 Stock Purchase' : '➖ Withdraw';
                      const amtColor = isDeposit ? 'var(--good)' : 'var(--bad)';
                      return (
                        <tr key={tx.id} style={{ borderBottom: '1px solid color-mix(in srgb, var(--line) 50%, transparent)' }}>
                          <td style={{ padding: '7px 8px', fontFamily: 'var(--mono, monospace)', fontSize: 10 }}>
                            {new Date(tx.ts).toLocaleDateString()}<br />
                            <span style={{ color: 'var(--muted)' }}>{new Date(tx.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </td>
                          <td style={{ padding: '7px 8px', fontSize: 10, fontWeight: 600 }}>{typeLabel}</td>
                          <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--mono, monospace)', fontWeight: 700, color: amtColor }}>
                            {isDeposit ? '+' : '-'}{fmtTotal(tx.amount)}
                          </td>
                          <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--mono, monospace)', fontWeight: 600 }}>
                            {fmtTotal(tx.balanceAfter)}
                          </td>
                          <td style={{ padding: '7px 8px', fontSize: 10 }}>
                            {tx.owner && <div style={{ fontWeight: 600 }}>{tx.owner}</div>}
                            {tx.bankAccount && <div style={{ color: 'var(--muted)' }}>🏦 {tx.bankAccount}</div>}
                            {tx.note && <div style={{ color: 'var(--muted)', fontStyle: 'italic' }}>{tx.note}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
