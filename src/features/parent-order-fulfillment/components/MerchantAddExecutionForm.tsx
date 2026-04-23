import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import type { MarketType } from '../types';

interface Props {
  parentOrderId: string;
  remainingUsdt: number;
  usdtQarRate: number;
  onSuccess?: () => void;
}

export function MerchantAddExecutionForm({ parentOrderId, remainingUsdt, usdtQarRate, onSuccess }: Props) {
  const qc = useQueryClient();
  const [executedEgp, setExecutedEgp] = useState('');
  const [egpPerUsdt, setEgpPerUsdt] = useState('');
  const [marketType, setMarketType] = useState<MarketType>('manual');

  // Compute preview values
  const numEgp = parseFloat(executedEgp) || 0;
  const numRate = parseFloat(egpPerUsdt) || 0;
  const previewUsdt = numRate > 0 ? numEgp / numRate : 0;
  const previewQar = previewUsdt * usdtQarRate;
  const previewFx = previewQar > 0 ? numEgp / previewQar : 0;

  const addExecution = useMutation({
    mutationFn: async () => {
      if (!numEgp || numEgp <= 0) {
        throw new Error('Enter a valid EGP amount');
      }
      if (!numRate || numRate <= 0) {
        throw new Error('Enter a valid EGP/USDT rate');
      }
      if (previewUsdt > remainingUsdt + 0.01) {
        throw new Error(`Phase USDT (${previewUsdt.toFixed(2)}) exceeds remaining ${remainingUsdt.toFixed(2)} USDT`);
      }

      const { data, error } = await supabase.rpc('insert_order_execution', {
        p_parent_order_id: parentOrderId,
        p_executed_egp: numEgp,
        p_egp_per_usdt: numRate,
        p_market_type: marketType,
        p_cash_account_id: null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Phase added');
      setExecutedEgp('');
      setEgpPerUsdt('');
      setMarketType('manual');
      qc.invalidateQueries({ queryKey: ['order-executions', parentOrderId] });
      qc.invalidateQueries({ queryKey: ['parent-order-summary', parentOrderId] });
      onSuccess?.();
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to add phase');
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* EGP Amount */}
        <Input
          type="number"
          value={executedEgp}
          onChange={e => setExecutedEgp(e.target.value)}
          placeholder="EGP"
          min="0"
          step="0.01"
          className="h-8 w-24 text-xs"
        />
        <span className="text-xs text-muted-foreground">@</span>
        {/* EGP per USDT rate */}
        <Input
          type="number"
          value={egpPerUsdt}
          onChange={e => setEgpPerUsdt(e.target.value)}
          placeholder="EGP/USDT"
          min="0"
          step="0.01"
          className="h-8 w-24 text-xs"
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
          disabled={addExecution.isPending || !executedEgp || !egpPerUsdt}
          className="h-8 gap-1 text-xs"
        >
          {addExecution.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add
        </Button>
      </div>
      {/* Preview computed values */}
      {numEgp > 0 && numRate > 0 && (
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span>USDT: <strong className="text-foreground">{previewUsdt.toFixed(2)}</strong></span>
          <span>QAR: <strong className="text-foreground">{previewQar.toFixed(2)}</strong></span>
          <span>FX: <strong className="text-foreground">{previewFx.toFixed(4)}</strong></span>
        </div>
      )}
    </div>
  );
}
