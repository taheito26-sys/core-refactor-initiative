import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Trash2, Loader2, PlugZap } from 'lucide-react';
import { toast } from 'sonner';
import { connectExchange, disconnectExchange, syncExchange } from '../api';
import { useExchangeCredentials, useInvalidateExchangeData } from '../hooks/useExchangeCredentials';
import { EXCHANGE_LABELS, type ExchangeId } from '../types';

function ExchangeConnectForm({ exchange, onConnected }: { exchange: ExchangeId; onConnected: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConnect = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.error('API key and secret are required');
      return;
    }
    if (exchange === 'okx' && !passphrase.trim()) {
      toast.error('OKX requires an API passphrase');
      return;
    }
    setSaving(true);
    try {
      await connectExchange({ exchange, apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), passphrase: passphrase.trim() || undefined });
      toast.success(`${EXCHANGE_LABELS[exchange]} connected`);
      setApiKey('');
      setApiSecret('');
      setPassphrase('');
      onConnected();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{EXCHANGE_LABELS[exchange]}</span>
        <Badge variant="outline">Not connected</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">API Key</Label>
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">API Secret</Label>
          <Input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="API secret" type="password" autoComplete="off" />
        </div>
        {exchange === 'okx' && (
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">API Passphrase</Label>
            <Input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Passphrase" type="password" autoComplete="off" />
          </div>
        )}
      </div>
      <Button size="sm" onClick={handleConnect} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
        Connect
      </Button>
      <p className="text-xs text-muted-foreground">
        Use a read-only API key (no withdrawal permission). Keys are stored per-account and never shown again.
      </p>
    </div>
  );
}

export function ExchangeConnectionsCard() {
  const { data: credentials, isLoading } = useExchangeCredentials();
  const invalidate = useInvalidateExchangeData();
  const [syncingExchange, setSyncingExchange] = useState<ExchangeId | null>(null);

  const connected = new Set((credentials ?? []).map((c) => c.exchange));
  const allExchanges: ExchangeId[] = ['binance', 'okx'];

  const handleSync = async (exchange: ExchangeId) => {
    setSyncingExchange(exchange);
    try {
      const result = await syncExchange(exchange, 'all');
      toast.success(`${EXCHANGE_LABELS[exchange]} synced: ${result.balances ?? 0} balances, ${result.p2pOrders ?? 0} P2P orders`);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingExchange(null);
    }
  };

  const handleDisconnect = async (exchange: ExchangeId) => {
    try {
      await disconnectExchange(exchange);
      toast.success(`${EXCHANGE_LABELS[exchange]} disconnected`);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Exchanges</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isLoading &&
          (credentials ?? []).map((c) => (
            <div key={c.id} className="space-y-1 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{EXCHANGE_LABELS[c.exchange]}</span>
                <Badge variant="secondary">Connected · {c.api_key.slice(0, 4)}…{c.api_key.slice(-4)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {c.last_synced_at ? `Last synced ${new Date(c.last_synced_at).toLocaleString()}` : 'Never synced'}
                {c.last_sync_error && <span className="text-destructive"> · Error: {c.last_sync_error}</span>}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => handleSync(c.exchange)} disabled={syncingExchange === c.exchange}>
                  {syncingExchange === c.exchange ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sync now
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDisconnect(c.exchange)}>
                  <Trash2 className="h-4 w-4" />
                  Disconnect
                </Button>
              </div>
            </div>
          ))}

        {allExchanges
          .filter((ex) => !connected.has(ex))
          .map((ex) => (
            <ExchangeConnectForm key={ex} exchange={ex} onConnected={invalidate} />
          ))}
      </CardContent>
    </Card>
  );
}
