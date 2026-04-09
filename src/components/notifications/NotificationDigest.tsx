import { useState } from 'react';
import { Sparkles, RefreshCw, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface DigestData {
  summary: string;
  count: number;
  categories: Record<string, number>;
}

export function NotificationDigest() {
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDigest = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('notification-digest');
      if (fnError) throw fnError;
      setDigest(data as DigestData);
    } catch (err: any) {
      setError(err.message ?? 'Failed to generate digest');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-primary/[0.04] via-card to-accent/[0.04]">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Brain className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-foreground">Smart Digest</h3>
              <p className="text-[10px] text-muted-foreground">AI-powered notification summary</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1.5 rounded-lg"
            onClick={fetchDigest}
            disabled={loading}
          >
            {loading ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {digest ? 'Refresh' : 'Generate'}
          </Button>
        </div>

        {error && (
          <p className="text-[11px] text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
        )}

        {digest && (
          <div className="space-y-3">
            {/* Category pills */}
            {Object.keys(digest.categories).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(digest.categories).map(([cat, count]) => (
                  <span
                    key={cat}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary capitalize"
                  >
                    {cat}: {count}
                  </span>
                ))}
              </div>
            )}

            {/* Summary */}
            <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line bg-card/80 rounded-lg p-3 border border-border/30">
              {digest.summary}
            </div>
          </div>
        )}

        {!digest && !loading && !error && (
          <p className="text-[11px] text-muted-foreground/60 text-center py-4">
            Click "Generate" to get an AI summary of your unread notifications
          </p>
        )}
      </div>
    </div>
  );
}
