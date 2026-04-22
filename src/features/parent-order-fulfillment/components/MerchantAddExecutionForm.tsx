import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MarketType } from '../types';

interface Props {
  parentOrderId: string;
  remainingQar: number;
  onSuccess?: () => void;
}

export function MerchantAddExecutionForm({ parentOrderId, remainingQar, onSuccess }: Props) {
  const qc = useQueryClient();
  const [soldAmount, setSoldAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [marketType, setMarketType] = useState<MarketType>('manual');
  const [showForm, setShowForm] = useState(false);

  const addExecution = useMutation({
    mutationFn: async () => {
      const numSoldAmount = parseFloat(soldAmount);
      const numFxRate = parseFloat(fxRate);

      if (!numSoldAmount || numSoldAmount <= 0) {
        throw new Error('Enter a valid sold amount');
      }

      if (!numFxRate || numFxRate <= 0) {
        throw new Error('Enter a valid FX rate');
      }

      if (numSoldAmount > remainingQar) {
        throw new Error(`Amount exceeds remaining ${remainingQar.toFixed(2)} QAR`);
      }

      const { data, error } = await supabase.rpc('insert_order_execution', {
        p_parent_order_id: parentOrderId,
        p_sold_qar_amount: numSoldAmount,
        p_fx_rate_qar_to_egp: numFxRate,
        p_market_type: marketType,
        p_cash_account_id: null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Execution added successfully');
      setSoldAmount('');
      setFxRate('');
      setMarketType('manual');
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['order-executions', parentOrderId] });
      qc.invalidateQueries({ queryKey: ['parent-order-summary', parentOrderId] });
      onSuccess?.();
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to add execution');
    },
  });

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="flex items-center gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add Execution
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-primary">Add New Execution</div>
        <div className="text-xs text-muted-foreground">
          Remaining: <span className="font-semibold">{remainingQar.toFixed(2)} QAR</span>
        </div>
      </div>

      {/* Sold Amount */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Sold Amount (QAR)</label>
        <div className="relative">
          <Input
            type="number"
            value={soldAmount}
            onChange={e => setSoldAmount(e.target.value)}
            placeholder="0"
            min="0"
            step="0.01"
            max={remainingQar}
            className="h-10 pe-16 text-sm"
          />
          <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">QAR</span>
        </div>
      </div>

      {/* FX Rate */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">FX Rate (QAR → EGP)</label>
        <div className="relative">
          <Input
            type="number"
            value={fxRate}
            onChange={e => setFxRate(e.target.value)}
            placeholder="13.9253"
            min="0"
            step="0.0001"
            className="h-10 pe-40 text-sm"
          />
          <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">1 QAR = ? EGP</span>
        </div>
      </div>

      {/* Market Type */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Market Type</label>
        <div className="flex flex-wrap gap-2">
          {(['manual', 'instapay_v1', 'p2p', 'bank'] as MarketType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setMarketType(type)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                marketType === type
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/50 bg-card text-muted-foreground hover:border-primary/40',
              )}
            >
              {type.replace('_', ' ').toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Calculated EGP */}
      {soldAmount && fxRate && (
        <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
          <div className="font-medium">EGP Received</div>
          <div className="text-lg font-bold">{(parseFloat(soldAmount) * parseFloat(fxRate)).toFixed(2)} EGP</div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={() => addExecution.mutate()}
          disabled={addExecution.isPending || !soldAmount || !fxRate}
          className="flex-1 h-10 gap-2"
        >
          {addExecution.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Add Execution
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setShowForm(false);
            setSoldAmount('');
            setFxRate('');
            setMarketType('manual');
          }}
          className="h-10"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
