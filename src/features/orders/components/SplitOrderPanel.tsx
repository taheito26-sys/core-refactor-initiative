import { useMemo, useState } from 'react';
import type { TranslationKey } from '@/lib/i18n';
import {
  allocateFee, exactCustomerMatch, legLoanPrincipal, legRevenue, matchCustomerOptions, round8,
  type SplitCashMode, type SplitCustomerOption, type SplitPlanError,
} from '../split-plan';

/*
 * One window for splitting an order between two customers. Both halves are
 * shown as identical cards, each with its own customer, quantity, price, loan
 * switch and cash deposit, so nothing is available to one half and missing
 * for the other. The quantities are tied together: typing one half fills the
 * other so they always add back up to the order total.
 */

export interface SplitPanelOption extends SplitCustomerOption {
  /** Shown as a small tag next to the name, e.g. a connected portal customer. */
  badge?: string;
}

export interface SplitLegState {
  buyerText: string;
  /** The picked customer's id; empty while the text is a name that matches nobody yet. */
  buyerId: string;
  qty: string;
  sellPrice: string;
  isLoan: boolean;
  cashMode: SplitCashMode;
  cashAmount: string;
  cashAccountId: string;
}

export interface SplitLegHandlers {
  onBuyerText: (value: string) => void;
  onBuyerPick: (option: SplitPanelOption) => void;
  onQty: (value: string) => void;
  onSellPrice: (value: string) => void;
  onLoan: (value: boolean) => void;
  onCashMode: (mode: SplitCashMode) => void;
  onCashAmount: (value: string) => void;
  onCashAccount: (id: string) => void;
}

export interface SplitCashAccount {
  id: string;
  name: string;
  type?: string;
  balance: number;
}

interface Props {
  t: (key: TranslationKey) => string;
  total: number;
  /** When provided, the order total is editable in the header (a new sale); omitted when it is fixed (editing a saved trade). */
  onTotalChange?: (value: string) => void;
  totalText?: string;
  /**
   * USDT of the same order already registered elsewhere (a partly registered
   * exchange order). The two customers share only what is left, but the
   * window keeps the whole order in view so the figures visibly add up to it.
   */
  registeredUsdt?: number;
  fee: number;
  legs: [SplitLegState, SplitLegState];
  handlers: [SplitLegHandlers, SplitLegHandlers];
  options: SplitPanelOption[];
  cashAccounts: SplitCashAccount[];
  fmtMoney: (value: number) => string;
  fmtQty: (value: number) => string;
  currencyLabel: string;
  isMobile?: boolean;
  error?: SplitPlanError | null;
  onEven: () => void;
  onSwap: () => void;
  /** Rendered under the summary, e.g. the confirm button of the edit window. */
  children?: React.ReactNode;
}

const numeric = (value: string) => value === '' || /^\d*\.?\d*$/.test(value);

const inputStyle = (mobile?: boolean): React.CSSProperties => ({
  width: '100%', boxSizing: 'border-box', background: 'var(--input-bg, var(--panel2))', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 8, outline: 'none',
  padding: mobile ? '12px 12px' : '8px 10px', fontSize: mobile ? 16 : 13, minHeight: mobile ? 46 : 36,
});

const labelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4,
};

function errorMessage(t: Props['t'], error: SplitPlanError): string {
  switch (error) {
    case 'qty_invalid': return t('splitAmountInvalid');
    case 'qty_too_large': return t('splitAmountTooLarge');
    case 'price_invalid': return t('splitNeedsPrice');
    case 'buyer_missing': return t('splitNeedsFirstCustomer');
    case 'second_buyer_missing': return t('splitCustomerRequired');
    case 'same_buyer': return t('splitNeedsDifferentCustomers');
  }
}

function CustomerPicker({ t, leg, handlers, options, excludeId, mobile }: {
  t: Props['t']; leg: SplitLegState; handlers: SplitLegHandlers; options: SplitPanelOption[]; excludeId: string; mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(
    () => matchCustomerOptions(options, leg.buyerText, excludeId || undefined),
    [options, leg.buyerText, excludeId],
  );
  const typed = leg.buyerText.trim();
  const exact = typed ? exactCustomerMatch(options, typed) : null;
  const isNew = !!typed && !leg.buyerId && !exact;
  return (
    <div style={{ position: 'relative' }}>
      <div style={labelStyle}>{leg.buyerId ? t('splitCustomerPicked') : isNew ? t('splitCustomerNew') : t('buyer')}</div>
      <input
        value={leg.buyerText}
        placeholder={t('splitCustomerSearch')}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { handlers.onBuyerText(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'Enter' && matches.length > 0) {
            e.preventDefault();
            handlers.onBuyerPick(matches[0]);
            setOpen(false);
          }
        }}
        style={{
          ...inputStyle(mobile), fontWeight: 700,
          borderColor: leg.buyerId ? 'var(--good)' : isNew ? 'var(--warn)' : 'var(--line)',
        }}
      />
      {open && (matches.length > 0 || isNew) && (
        <div style={{
          position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, maxHeight: 220, overflowY: 'auto',
          background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
        }}>
          {matches.map(option => (
            <button
              key={option.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); handlers.onBuyerPick(option); setOpen(false); }}
              style={{
                display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 8, textAlign: 'start',
                padding: mobile ? '12px 12px' : '8px 10px', background: 'transparent', color: 'var(--text)', border: 'none',
                borderBottom: '1px solid var(--line2, var(--line))', cursor: 'pointer', fontSize: mobile ? 15 : 12,
              }}
            >
              <span style={{ fontWeight: 600 }}>{option.name}</span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{option.badge || option.phone || ''}</span>
            </button>
          ))}
          {isNew && (
            <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--warn)' }}>
              ＋ {t('splitNewCustomer')}: <strong>{typed}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LegCard({ index, t, leg, handlers, options, excludeId, accounts, feeShare, fmtMoney, currencyLabel, mobile }: {
  index: 0 | 1; t: Props['t']; leg: SplitLegState; handlers: SplitLegHandlers; options: SplitPanelOption[]; excludeId: string;
  accounts: SplitCashAccount[]; feeShare: number; fmtMoney: Props['fmtMoney']; currencyLabel: string; mobile?: boolean;
}) {
  const qty = Number(leg.qty) || 0;
  const price = Number(leg.sellPrice) || 0;
  const revenue = legRevenue(qty, price);
  const owed = legLoanPrincipal(qty, price, feeShare);
  const accent = index === 0 ? 'var(--brand, #4f8cff)' : 'var(--warn)';
  const cashAmount = leg.cashMode === 'full' ? revenue : Math.min(Number(leg.cashAmount) || 0, revenue);
  const name = leg.buyerText.trim();
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: 12, minWidth: 0,
      border: `1.5px solid color-mix(in srgb, ${accent} 45%, var(--line))`,
      background: `color-mix(in srgb, ${accent} 5%, var(--panel))`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 13, color: '#fff', background: accent, flexShrink: 0,
        }}>{index + 1}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>{index === 0 ? t('splitLegFirst') : t('splitLegSecond')}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{index === 0 ? t('splitLegFirstHint') : t('splitLegSecondHint')}</div>
        </div>
      </div>

      <CustomerPicker t={t} leg={leg} handlers={handlers} options={options} excludeId={excludeId} mobile={mobile} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div style={labelStyle}>{t('splitQtyLabel')}</div>
          <input
            inputMode="decimal" value={leg.qty} style={inputStyle(mobile)}
            onChange={e => { if (numeric(e.target.value)) handlers.onQty(e.target.value); }}
          />
        </div>
        <div>
          <div style={labelStyle}>{t('splitPriceLabel')}</div>
          <input
            inputMode="decimal" value={leg.sellPrice} style={inputStyle(mobile)}
            onChange={e => { if (numeric(e.target.value)) handlers.onSellPrice(e.target.value); }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{t('splitLegTotal')}</span>
        <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: accent }}>
          {fmtMoney(revenue)} <span style={{ fontSize: 10, color: 'var(--muted)' }}>{currencyLabel}</span>
        </span>
      </div>
      {feeShare > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: -8 }}>
          <span>{t('splitFeeShare')}</span><span className="mono">{fmtMoney(feeShare)}</span>
        </div>
      )}

      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', borderRadius: 8, cursor: 'pointer',
        border: leg.isLoan ? '1px solid var(--warn)' : '1px solid var(--line)',
        background: leg.isLoan ? 'color-mix(in srgb, var(--warn) 8%, transparent)' : 'transparent',
        color: leg.isLoan ? 'var(--warn)' : 'var(--t2)', fontSize: mobile ? 13 : 11, fontWeight: leg.isLoan ? 700 : 500,
      }}>
        <input
          type="checkbox" checked={leg.isLoan} onChange={e => handlers.onLoan(e.target.checked)}
          style={{ accentColor: 'var(--warn)', width: 16, height: 16, flexShrink: 0 }}
        />
        <span>🤝 {t('loanSaleCheckbox')}</span>
      </label>
      {leg.isLoan && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: -4, gap: 8 }}>
          <span style={{ color: 'var(--t2)', minWidth: 0, overflowWrap: 'anywhere' }}>{name || (index === 0 ? t('splitLegFirst') : t('splitLegSecond'))} {t('splitOwes')}</span>
          <strong className="mono" style={{ color: 'var(--warn)', flexShrink: 0 }}>{fmtMoney(owed)} {currencyLabel}</strong>
        </div>
      )}

      <div style={{
        padding: '10px', borderRadius: 8,
        background: 'color-mix(in srgb, var(--good) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 20%, transparent)',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--good)', marginBottom: 6 }}>{t('addSaleProceedsToCash')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['none', 'full', 'partial'] as const).map(mode => (
            <button
              key={mode} type="button" onClick={() => handlers.onCashMode(mode)}
              style={{
                padding: mobile ? '9px 10px' : '5px 10px', borderRadius: 6, fontSize: mobile ? 12 : 10, fontWeight: 600, cursor: 'pointer',
                minHeight: mobile ? 40 : undefined,
                border: leg.cashMode === mode ? '1.5px solid var(--good)' : '1px solid var(--line)',
                background: leg.cashMode === mode ? 'color-mix(in srgb, var(--good) 15%, transparent)' : 'var(--panel2)',
                color: leg.cashMode === mode ? 'var(--good)' : 'var(--t2)',
              }}
            >
              {mode === 'none' ? t('dontAdd') : mode === 'full' ? `${t('fullAmount')} (${fmtMoney(revenue)})` : t('customAmount')}
            </button>
          ))}
        </div>
        {leg.cashMode === 'partial' && (
          <div style={{ marginTop: 8 }}>
            <input
              inputMode="decimal" placeholder={t('amountInQar')} value={leg.cashAmount} style={inputStyle(mobile)}
              onChange={e => { if (numeric(e.target.value)) handlers.onCashAmount(e.target.value); }}
            />
          </div>
        )}
        {leg.cashMode !== 'none' && accounts.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t2)', marginBottom: 4 }}>{t('depositTo')}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {accounts.map(account => {
                const selected = leg.cashAccountId === account.id;
                return (
                  <button
                    key={account.id} type="button" onClick={() => handlers.onCashAccount(account.id)}
                    style={{
                      padding: '5px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: 'pointer', minWidth: 90,
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                      border: selected ? '1.5px solid var(--good)' : '1px solid var(--line)',
                      background: selected ? 'color-mix(in srgb, var(--good) 12%, transparent)' : 'var(--panel2)',
                      color: selected ? 'var(--good)' : 'var(--t2)',
                    }}
                  >
                    <span>{account.type === 'hand' ? '💵' : account.type === 'bank' ? '🏦' : '🔐'} {account.name}</span>
                    <span className="mono" style={{ fontSize: 9, opacity: 0.8 }}>{fmtMoney(account.balance)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {leg.cashMode !== 'none' && cashAmount > 0 && (
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--good)' }}>+{fmtMoney(cashAmount)} {currencyLabel}</div>
        )}
      </div>
    </div>
  );
}

export function SplitOrderPanel({
  t, total, onTotalChange, totalText, registeredUsdt = 0, fee, legs, handlers, options, cashAccounts, fmtMoney, fmtQty, currencyLabel, isMobile, error, onEven, onSwap, children,
}: Props) {
  const qtyA = Number(legs[0].qty) || 0;
  const qtyB = Number(legs[1].qty) || 0;
  const [feeA, feeB] = allocateFee(fee, qtyA, qtyB);
  const revenueA = legRevenue(qtyA, Number(legs[0].sellPrice) || 0);
  const revenueB = legRevenue(qtyB, Number(legs[1].sellPrice) || 0);
  const wholeOrder = registeredUsdt + total;
  const barPct = (n: number) => (wholeOrder > 0 ? Math.max(0, Math.min(100, (n / wholeOrder) * 100)) : 0);
  const button: React.CSSProperties = {
    padding: isMobile ? '9px 12px' : '5px 12px', borderRadius: 999, fontSize: isMobile ? 12 : 11, fontWeight: 700, cursor: 'pointer',
    border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--t2)', minHeight: isMobile ? 38 : undefined,
  };
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12, padding: isMobile ? 10 : 14, borderRadius: 14,
      border: '1.5px solid color-mix(in srgb, var(--warn) 35%, var(--line))', background: 'color-mix(in srgb, var(--warn) 4%, transparent)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>✂️ {t('splitWindowTitle')}</div>
          {registeredUsdt > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'grid', gap: 2, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <span>{t('splitOrderTotal')}</span>
                <strong className="mono" style={{ color: 'var(--text)' }}>{fmtQty(round8(registeredUsdt + total))} USDT</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <span>{t('splitAlreadyRegistered')}</span>
                <span className="mono">−{fmtQty(registeredUsdt)} USDT</span>
              </div>
            </div>
          )}
          {onTotalChange ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
              <span>{registeredUsdt > 0 ? t('splitToAllocate') : t('splitOrderTotal')}</span>
              <input
                inputMode="decimal" value={totalText ?? ''} placeholder="0"
                onChange={e => { if (numeric(e.target.value)) onTotalChange(e.target.value); }}
                style={{ ...inputStyle(isMobile), width: isMobile ? 130 : 110, minHeight: isMobile ? 40 : 30, padding: '4px 8px', fontWeight: 800 }}
              />
              <span>USDT</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {registeredUsdt > 0 ? t('splitToAllocate') : t('splitOrderTotal')}: <strong className="mono" style={{ color: 'var(--text)' }}>{fmtQty(total)} USDT</strong>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={button} onClick={onEven}>{t('splitEvenButton')}</button>
          <button type="button" style={button} onClick={onSwap}>⇄ {t('splitSwapButton')}</button>
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--line)' }}>
          {registeredUsdt > 0 && <span style={{ width: `${barPct(registeredUsdt)}%`, background: 'var(--muted)', opacity: 0.5 }} />}
          <span style={{ width: `${barPct(qtyA)}%`, background: 'var(--brand, #4f8cff)', transition: 'width .15s' }} />
          <span style={{ width: `${barPct(qtyB)}%`, background: 'var(--warn)', transition: 'width .15s' }} />
        </div>
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 10, marginTop: 4, color: 'var(--muted)' }}>
          {registeredUsdt > 0 && <span>✓ {fmtQty(registeredUsdt)}</span>}
          <span>1 · {fmtQty(qtyA)} USDT</span>
          <span>2 · {fmtQty(qtyB)} USDT</span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}>
        <LegCard
          index={0} t={t} leg={legs[0]} handlers={handlers[0]} options={options} excludeId={legs[1].buyerId}
          accounts={cashAccounts} feeShare={feeA} fmtMoney={fmtMoney} currencyLabel={currencyLabel} mobile={isMobile}
        />
        <LegCard
          index={1} t={t} leg={legs[1]} handlers={handlers[1]} options={options} excludeId={legs[0].buyerId}
          accounts={cashAccounts} feeShare={feeB} fmtMoney={fmtMoney} currencyLabel={currencyLabel} mobile={isMobile}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{t('splitCombined')}</span>
        <strong className="mono" style={{ fontSize: 16 }}>{fmtMoney(revenueA + revenueB)} <span style={{ fontSize: 10, color: 'var(--muted)' }}>{currencyLabel}</span></strong>
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 12, fontWeight: 600, color: 'var(--bad)' }}>⚠ {errorMessage(t, error)}</div>
      )}
      {children}
    </div>
  );
}
