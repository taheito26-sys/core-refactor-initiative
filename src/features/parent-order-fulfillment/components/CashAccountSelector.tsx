/**
 * CashAccountSelector
 *
 * Lists the authenticated customer's active cash accounts for selection.
 * Used inside AcceptOrderModal to pick a destination account for EGP proceeds.
 *
 * - Grey out disabled accounts with tooltip
 * - Show inline warning on currency mismatch
 * - Show inline hint when no account is selected
 *
 * Requirements: 7.1, 7.2, 7.3, 7.14, 7.15, 8.5
 */

import { useCashAccountsForUser } from '../hooks/useCashAccountsForUser';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CashAccount } from '../types';

interface CashAccountSelectorProps {
  selectedAccountId: string | null;
  onSelect: (accountId: string | null) => void;
  expectedCurrency: string;
}

export function CashAccountSelector({
  selectedAccountId,
  onSelect,
  expectedCurrency,
}: CashAccountSelectorProps) {
  const { accounts, isLoading, error } = useCashAccountsForUser();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Failed to load accounts. Please try again.
      </p>
    );
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active cash accounts found. Please contact support.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Inline hint when nothing is selected */}
      {!selectedAccountId && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          <Info className="h-4 w-4 shrink-0" />
          <span>Select a cash account to receive the EGP proceeds</span>
        </div>
      )}

      <TooltipProvider>
        {accounts.map((account) => {
          const isDisabled = account.status !== 'active';
          const hasCurrencyMismatch = account.currency !== expectedCurrency;
          const isSelected = account.id === selectedAccountId;

          const accountButton = (
            <button
              key={account.id}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(isSelected ? null : account.id)}
              className={cn(
                'w-full text-left rounded-lg border p-3 transition-colors',
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-primary/50',
                isDisabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">
                    {account.nickname ?? account.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {account.type} · {account.currency}
                    {account.bankName ? ` · ${account.bankName}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {hasCurrencyMismatch && !isDisabled && (
                    <Badge
                      variant="outline"
                      className="bg-amber-50 text-amber-700 border-amber-200 text-xs gap-1"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      Currency mismatch
                    </Badge>
                  )}
                  {isSelected && (
                    <Badge className="bg-primary text-primary-foreground text-xs">
                      Selected
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          );

          // Wrap disabled accounts in a tooltip
          if (isDisabled) {
            return (
              <Tooltip key={account.id}>
                <TooltipTrigger asChild>{accountButton}</TooltipTrigger>
                <TooltipContent>
                  <p>This account is inactive and cannot be selected</p>
                </TooltipContent>
              </Tooltip>
            );
          }

          return accountButton;
        })}
      </TooltipProvider>
    </div>
  );
}
