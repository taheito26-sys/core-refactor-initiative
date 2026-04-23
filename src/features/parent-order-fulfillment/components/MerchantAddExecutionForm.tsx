import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2, Plus, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
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

  const numEgp = parseFloat(executedEgp) || 0;
  const numRate = parseFloat(egpPerUsdt) || 0;
  const previewUsdt = numRate > 0 ? numEgp / numRate : 0;
  const previewQar = previewUsdt * usdtQarRate;
  const previewFx = previewQar > 0 ? numEgp / previewQar : 0;
  const exceedsRemaining = previewUsdt > remainingUsdt + 0.01;
  const progressPercent = remainingUsdt > 0 ? Math.min((previewUsdt / remainingUsdt) * 100, 100) : 0;

  const addExecution = useMutation({
    mutationFn: async () => {
      if (!numEgp || numEgp <= 0) {
        throw new Error('Enter a valid EGP amount');
      }
      if (!numRate || numRate <= 0) {
        throw new Error('Enter a valid EGP/USDT rate');
      }
      if (exceedsRemaining) {
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

  const isValid = numEgp > 0 && numRate > 0 && !exceedsRemaining;

  return (
    <div className="space-y-2">
      {/* Main form row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* EGP Amount */}
        <div className="flex flex-col gap-0.5">
          <Input
            type="number"
            value={executedEgp}
            onChange={e => setExecutedEgp(e.target.value)}
            placeholder="EGP"
            min="0"
            step="0.01"
            className="h-8 w-20 text-xs"
          />
          <span className="text-[9px] text-muted-foreground text-center">EGP</span>
        </div>

        <span className="text-xs text-muted-foreground font-medium">@</span>

        {/* FX Rate (EGP per USDT) */}
        <div className="flex flex-col gap-0.5">
          <Input
            type="number"
            value={egpPerUsdt}
            onChange={e => setEgpPerUsdt(e.target.value)}
            placeholder="Rate"
            min="0"
            step="0.01"
            className="h-8 w-20 text-xs"
          />
          <span className="text-[9px] text-muted-foreground text-center">Rate</span>
        </div>

        {/* Market Type */}
        <select
          value={marketType}
          onChange={e => setMarketType(e.target.value as MarketType)}
          className="h-8 rounded-md border border-border/50 bg-card px-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="manual">Manual</option>
          <option value="instapay_v1">InstaPay</option>
          <option value="p2p">P2P</option>
          <option value="bank">Bank</option>
        </select>

        {/* Add Button */}
        <Button
          size="sm"
          onClick={() => addExecution.mutate()}
          disabled={addExecution.isPending || !isValid}
          className="h-8 gap-1 text-xs"
        >
          {addExecution.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add
        </Button>
      </div>

      {/* Real-time calculations and feedback */}
      {numEgp > 0 && numRate > 0 ? (
        <div className="space-y-1.5">
          {/* Calculated values row */}
          <div className="flex items-center gap-2 text-[10px]">
            <span>
              <strong className="text-foreground">{previewUsdt.toFixed(2)}</strong>
              <span className={cn('ml-1', exceedsRemaining ? 'text-red-500' : 'text-muted-foreground')}>
                USDT
              </span>
            </span>
            <span className="text-muted-foreground">•</span>
            <span>
              <strong className="text-foreground">{previewQar.toFixed(2)}</strong>
              <span className="ml-1 text-muted-foreground">QAR</span>
            </span>
            <span className="text-muted-foreground">•</span>
            <span>
              <strong className="text-foreground">{previewFx.toFixed(4)}</strong>
              <span className="ml-1 text-muted-foreground">FX</span>
            </span>
          </div>

          {/* Remaining USDT and progress */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  exceedsRemaining ? 'bg-red-500' : 'bg-primary'
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className={cn(
              'text-[9px] font-semibold whitespace-nowrap',
              exceedsRemaining ? 'text-red-600' : 'text-muted-foreground'
            )}>
              {previewUsdt.toFixed(2)} / {remainingUsdt.toFixed(2)}
            </span>
          </div>

          {/* Error message if exceeds */}
          {exceedsRemaining && (
            <div className="flex items-center gap-1.5 rounded bg-red-500/10 px-2 py-1">
              <AlertCircle className="h-3 w-3 text-red-600 flex-shrink-0" />
              <span className="text-[9px] text-red-600">
                Exceeds remaining {remainingUsdt.toFixed(2)} USDT by {(previewUsdt - remainingUsdt).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
