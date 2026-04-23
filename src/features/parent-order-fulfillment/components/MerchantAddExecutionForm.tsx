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
      toast.success('Execution added');
      setSoldAmount('');
      setFxRate('');
      setMarketType('manual');
      qc.invalidateQueries({ queryKey: ['order-executions', parentOrderId] });
      qc.invalidateQueries({ queryKey: ['parent-order-summary', parentOrderId] });
      onSuccess?.();
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to add execution');
    },
  });

  return (
    <div className="flex items-center gap-2">
      {/* Compact inline form */}
      <Input
        type="number"
        value={soldAmount}
        onChange={e => setSoldAmount(e.target.value)}
        placeholder="QAR"
        min="0"
        step="0.01"
        max={remainingQar}
        className="h-8 w-20 text-xs"
      />
      <span className="text-xs text-muted-foreground">@</span>
      <Input
        type="number"
        value={fxRate}
        onChange={e => setFxRate(e.target.value)}
        placeholder="Rate"
        min="0"
        step="0.0001"
        className="h-8 w-20 text-xs"
      />
      <select
        value={marketType}
        onChange={e => setMarketType(e.target.value as MarketType)}
        className="h-8 rounded-md border border-border/50 bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
      >
        <option value="manual">Manual</option>
        <option value="instapay_v1">InstaPay</option>
        <option value="p2p">P2P</option>
        <option value="bank">Bank</option>
      </select>
      <Button
        size="sm"
        onClick={() => addExecution.mutate()}
        disabled={addExecution.isPending || !soldAmount || !fxRate}
        className="h-8 gap-1 text-xs"
      >
        {addExecution.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Add
      </Button>
    </div>
  );
}
