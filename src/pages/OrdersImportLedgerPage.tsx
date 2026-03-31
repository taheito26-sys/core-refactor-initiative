import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { parseLedgerText } from '@/services/ledgerImport/parser';
import type { LedgerDirection, LedgerParseRow } from '@/types/ledgerImport';

const DEFAULT_COUNTERPARTY = 'Zack';

function fmtDirection(direction: LedgerDirection | null): string {
  if (direction === 'merchant_to_me') return 'merchant_to_me';
  if (direction === 'me_to_merchant') return 'me_to_merchant';
  return '—';
}

export default function OrdersImportLedgerPage() {
  const navigate = useNavigate();
  const { userId, merchantProfile } = useAuth();
  const [rawText, setRawText] = useState('');
  const [batchId, setBatchId] = useState('');
  const [rows, setRows] = useState<LedgerParseRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const canParse = rawText.trim().length > 0 && !!userId;

  const saveableRows = useMemo(
    () => rows.filter((row) => row.status === 'parsed' && row.type === 'merchant_deal' && row.saveEnabled),
    [rows],
  );

  const handleParse = () => {
    if (!userId) {
      toast.error('No authenticated user context found.');
      return;
    }

    const parsed = parseLedgerText(rawText, {
      ownerUserId: userId,
      ownerDisplayName: merchantProfile?.display_name || 'Mohamed',
      defaultCounterpartyMerchant: DEFAULT_COUNTERPARTY,
    });

    setBatchId(parsed.batchId);
    setRows(parsed.rows);
    toast.success(`Parsed ${parsed.totals.parsed} supported row(s), skipped ${parsed.totals.skipped}.`);
  };

  const resolveZackRelationship = async () => {
    const myMerchantId = merchantProfile?.merchant_id;
    if (!myMerchantId) throw new Error('Missing merchant profile for current user.');

    const [relsRes, profilesRes] = await Promise.all([
      supabase
        .from('merchant_relationships')
        .select('*')
        .eq('status', 'active')
        .or(`merchant_a_id.eq.${myMerchantId},merchant_b_id.eq.${myMerchantId}`),
      supabase.from('merchant_profiles').select('merchant_id, display_name, nickname, merchant_code'),
    ]);

    if (relsRes.error) throw relsRes.error;
    if (profilesRes.error) throw profilesRes.error;

    const profileMap = new Map((profilesRes.data || []).map((profile) => [profile.merchant_id, profile]));

    const zackRel = (relsRes.data || []).find((rel) => {
      const counterpartyId = rel.merchant_a_id === myMerchantId ? rel.merchant_b_id : rel.merchant_a_id;
      const profile = profileMap.get(counterpartyId);
      const candidates = [profile?.display_name, profile?.nickname, profile?.merchant_code, counterpartyId]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      return candidates.some((value) => value.includes('zack') || value.includes('زاك'));
    });

    if (!zackRel) {
      throw new Error('Could not find an active relationship with Zack.');
    }

    return zackRel.id as string;
  };

  const updateRow = (id: string, updates: Partial<LedgerParseRow>) => {
    setRows((prev) => prev.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...updates };
      if (next.usdtAmount && next.rate) {
        next.computedQarAmount = Number.parseFloat((next.usdtAmount * next.rate).toFixed(2));
      }
      next.saveEnabled = next.status === 'parsed' && next.type === 'merchant_deal' && next.confidence >= 0.7;
      return next;
    }));
  };

  const handleSave = async () => {
    if (!userId) return;
    if (saveableRows.length === 0) {
      toast.error('No supported rows available to save.');
      return;
    }

    const approved = window.confirm(`Save ${saveableRows.length} supported row(s) from this batch?`);
    if (!approved) return;

    setIsSaving(true);
    try {
      const relationshipId = await resolveZackRelationship();
      const payload = saveableRows.map((row) => {
        const noteParts = [
          `template: ledger_import_phase_1`,
          `quantity: ${row.usdtAmount}`,
          `sell_price: ${row.rate}`,
          `direction: ${row.direction}`,
          `import_source: manual_ledger_import`,
          `import_batch_id: ${batchId}`,
          `raw_line: ${row.rawLine}`,
          `intermediary: ${row.intermediary || ''}`,
          `parse_confidence: ${row.confidence}`,
        ];

        return {
          relationship_id: relationshipId,
          deal_type: 'arbitrage',
          title: `Ledger Import · USDT ${row.usdtAmount} @ ${row.rate}`,
          amount: row.computedQarAmount || 0,
          currency: 'USDT',
          status: 'pending',
          created_by: userId,
          notes: noteParts.join(' | '),
          metadata: {
            import_source: 'manual_ledger_import',
            import_batch_id: batchId,
            raw_line: row.rawLine,
            intermediary: row.intermediary,
            parse_confidence: row.confidence,
            direction: row.direction,
            owner_user_id: row.ownerUserId,
            counterparty_merchant: row.counterpartyMerchant,
            phase: 'phase_1',
          },
        };
      });

      const { error } = await supabase.from('merchant_deals').insert(payload);
      if (error) throw error;

      toast.success(`Saved ${payload.length} row(s) from ledger import.`);
      navigate('/trading/orders');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save ledger import rows.';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="tracker-root" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Import Merchant Ledger</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Phase 1 (USDT merchant deals only)</div>
        </div>
        <button className="btn secondary" onClick={() => navigate('/trading/orders')}>Back to Orders</button>
      </div>

      <div className="card" style={{ padding: 10, display: 'grid', gap: 8 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>Raw Arabic ledger text</span>
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            rows={8}
            placeholder="الصق النص هنا..."
            style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)' }}
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>Current user</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Mohamed (from auth)</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>Default counterparty</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{DEFAULT_COUNTERPARTY}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={handleParse} disabled={!canParse}>Parse</button>
          <button className="btn" onClick={handleSave} disabled={isSaving || saveableRows.length === 0}>
            {isSaving ? 'Saving...' : `Confirm & Save (${saveableRows.length})`}
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="tableWrap ledgerWrap">
          <table>
            <thead>
              <tr>
                <th>Raw line</th>
                <th>Parse result</th>
                <th>Type</th>
                <th>Direction</th>
                <th className="r">USDT amount</th>
                <th className="r">Rate</th>
                <th className="r">QAR amount</th>
                <th>Counterparty</th>
                <th>Intermediary</th>
                <th className="r">Confidence</th>
                <th>Save enabled?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.id}-${row.rawLine}`}>
                  <td style={{ maxWidth: 260 }}>{row.rawLine}</td>
                  <td>{row.parseResult}</td>
                  <td>{row.type}</td>
                  <td>{fmtDirection(row.direction)}</td>
                  <td className="r">
                    {row.status === 'parsed' ? (
                      <input className="inp" value={row.usdtAmount ?? ''} onChange={(e) => updateRow(row.id, { usdtAmount: Number.parseFloat(e.target.value) || null })} />
                    ) : (row.usdtAmount ?? '—')}
                  </td>
                  <td className="r">
                    {row.status === 'parsed' ? (
                      <input className="inp" value={row.rate ?? ''} onChange={(e) => updateRow(row.id, { rate: Number.parseFloat(e.target.value) || null })} />
                    ) : (row.rate ?? '—')}
                  </td>
                  <td className="r">{row.computedQarAmount ?? '—'}</td>
                  <td>{row.counterpartyMerchant}</td>
                  <td>
                    {row.status === 'parsed' ? (
                      <input className="inp" value={row.intermediary ?? ''} onChange={(e) => updateRow(row.id, { intermediary: e.target.value || null })} />
                    ) : (row.intermediary ?? '—')}
                  </td>
                  <td className="r">{row.confidence.toFixed(2)}</td>
                  <td>{row.saveEnabled ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
