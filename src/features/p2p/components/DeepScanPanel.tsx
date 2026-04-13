import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Search, Zap, Loader2, AlertTriangle } from 'lucide-react';
import { P2POffer } from '../types';
import { MerchantIntelligenceCard } from './MerchantIntelligenceCard';

interface Props {
  buyOffers: P2POffer[];
}

export function DeepScanPanel({ buyOffers }: Props) {
  const [amount, setAmount] = useState('10000');
  const [singleOnly, setSingleOnly] = useState(true);
  const [results, setResults] = useState<P2POffer[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const runScan = () => {
    const required = parseFloat(amount);
    if (isNaN(required) || required <= 0) return;

    setIsScanning(true);
    setTimeout(() => {
      const matches = buyOffers.filter(o => {
        if (singleOnly) return o.available >= required && o.max >= required;
        return true;
      }).sort((a, b) => a.price - b.price);
      
      setResults(matches);
      setIsScanning(false);
    }, 400);
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-gradient-to-br from-card to-background shadow-lg">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-[11px] font-black uppercase tracking-widest flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-primary fill-primary/20" />
            Deep Market Scan
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Required USDT</Label>
            <Input 
              type="number" 
              value={amount} 
              onChange={e => setAmount(e.target.value)}
              className="h-9 font-black font-mono bg-muted/20 border-border/50"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
            <div className="space-y-0.5">
              <Label className="text-[10px] font-black uppercase tracking-widest cursor-pointer" htmlFor="ds-single">Single Merchant</Label>
              <p className="text-[9px] text-muted-foreground leading-tight">Full amount fulfillment</p>
            </div>
            <Switch id="ds-single" checked={singleOnly} onCheckedChange={setSingleOnly} />
          </div>

          <Button onClick={runScan} disabled={isScanning} className="w-full h-10 font-black uppercase tracking-widest text-[11px] gap-2">
            {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Run Deep Scan
          </Button>
        </CardContent>
      </Card>

      {results && (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {results.length} Matches Found
            </h3>
            <button onClick={() => setResults(null)} className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline">Clear</button>
          </div>
          {results.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed rounded-xl bg-muted/10 opacity-50">
              <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
              <p className="text-[10px] font-black uppercase tracking-widest">No Matches Found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {results.map((m, i) => <MerchantIntelligenceCard key={i} merchant={m} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}