/* ═══════════════════════════════════════════════════════════════
   ContextPanel — Rocket.Chat-style right panel
   Shows related order / agreement / status cards
   ═══════════════════════════════════════════════════════════════ */

interface Relationship {
  id: string;
  counterparty_name: string;
  counterparty_nickname: string;
  counterparty_code?: string;
  merchant_a_id: string;
  merchant_b_id: string;
}

interface Props {
  relationship: Relationship | null;
}

export function ContextPanel({ relationship }: Props) {
  if (!relationship) {
    return (
      <div className="w-[260px] flex-shrink-0 border-l border-border flex items-center justify-center text-muted-foreground text-xs p-5 bg-card">
        Select a conversation to see details
      </div>
    );
  }

  return (
    <div className="w-[260px] flex-shrink-0 border-l border-border overflow-y-auto bg-card h-full">
      {/* Context card — matching the reference style */}
      <div className="p-4">
        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <div className="text-xs font-bold text-foreground">
            Related Order: <span className="text-primary">#{Math.floor(Math.random() * 300 + 100)}</span>
          </div>
          <div className="h-px bg-border" />
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Agreement:</span>
            <br />
            Profit Share A
          </div>
          <div className="h-px bg-border" />
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Status:</span>{' '}
            <span className="text-amber-400 font-semibold">Pending approval</span>
          </div>
        </div>
      </div>
    </div>
  );
}
