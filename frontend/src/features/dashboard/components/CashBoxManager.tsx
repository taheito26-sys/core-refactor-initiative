import { useState, useMemo } from 'react';
import { fmtTotal, num } from '@/lib/tracker-helpers';
import '@/styles/tracker.css';

interface CashBoxManagerProps {
  currentCash: number;
  currentOwner: string;
  onSave: (newCash: number, owner: string) => void;
  onClose: () => void;
}

export function CashBoxManager({ currentCash, currentOwner, onSave, onClose }: CashBoxManagerProps) {
  const [addAmount, setAddAmount] = useState('');
  const [owner, setOwner] = useState(currentOwner);

  const addNum = num(parseFloat(addAmount) || 0, 0);
  const totalAfterAdd = currentCash + addNum;

  const handleAddCash = () => {
    if (addNum <= 0) return;
    onSave(totalAfterAdd, owner);
    onClose();
  };

  const handleClearCash = () => {
    onSave(0, owner);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      }} />
      <div
        style={{
          position: 'relative', zIndex: 1,
          background: 'var(--panel2)', border: '1px solid var(--line)',
          borderRadius: 10, padding: '20px 24px', width: '100%', maxWidth: 480,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Cash Box Manager</div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: 'var(--muted)',
              cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Current balance */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: 'var(--good)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Current cash balance (QAR)
          </label>
          <div style={{
            background: 'var(--cardBg)', border: '1px solid var(--line)',
            borderRadius: 6, padding: '10px 14px',
            fontSize: 16, fontWeight: 800, color: 'var(--text)',
            fontFamily: 'var(--mono, monospace)',
          }}>
            {fmtTotal(currentCash)} QAR
          </div>
        </div>

        {/* Add cash amount */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--good)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Add cash amount (QAR)
          </label>
          <input
            type="number"
            placeholder="e.g. 20000"
            value={addAmount}
            onChange={e => setAddAmount(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px',
              background: 'var(--cardBg)', border: '1px solid var(--line)',
              borderRadius: 6, color: 'var(--text)', fontSize: 13,
              fontFamily: 'var(--mono, monospace)',
              outline: 'none',
            }}
          />
        </div>

        {/* Total after add */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--good)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Total after add (QAR)
          </label>
          <input
            type="text"
            readOnly
            value={fmtTotal(totalAfterAdd)}
            style={{
              width: '100%', padding: '8px 12px',
              background: 'var(--cardBg)', border: '1px solid var(--line)',
              borderRadius: 6, color: 'var(--text)', fontSize: 13,
              fontFamily: 'var(--mono, monospace)',
              outline: 'none', opacity: 0.8,
            }}
          />
        </div>

        {/* Cash owner */}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--good)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Cash owner / source description
          </label>
          <textarea
            placeholder="Example: This cash belongs to Ahmad"
            value={owner}
            onChange={e => setOwner(e.target.value)}
            rows={2}
            style={{
              width: '100%', padding: '8px 12px',
              background: 'var(--cardBg)', border: '1px solid var(--line)',
              borderRadius: 6, color: 'var(--text)', fontSize: 12,
              resize: 'vertical', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 16 }}>
          Use Add Cash to increase balance, or Clear Cash when funds were used to buy USDT.
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', fontSize: 12, fontWeight: 600,
              background: 'transparent', border: '1px solid var(--line)',
              borderRadius: 6, color: 'var(--text)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleClearCash}
            style={{
              padding: '8px 18px', fontSize: 12, fontWeight: 700,
              background: 'transparent', border: '1px solid var(--bad)',
              borderRadius: 6, color: 'var(--bad)', cursor: 'pointer',
            }}
          >
            Clear Cash
          </button>
          <button
            onClick={handleAddCash}
            disabled={addNum <= 0}
            style={{
              padding: '8px 18px', fontSize: 12, fontWeight: 700,
              background: 'var(--good)', border: 'none',
              borderRadius: 6, color: '#fff', cursor: addNum > 0 ? 'pointer' : 'not-allowed',
              opacity: addNum > 0 ? 1 : 0.5,
            }}
          >
            Add Cash
          </button>
        </div>
      </div>
    </div>
  );
}
