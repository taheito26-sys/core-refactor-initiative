/**
 * AcceptOrderModal
 *
 * Dialog shown when a customer clicks "Accept Order". Contains a
 * CashAccountSelector for picking the destination account, validates
 * the selection, then calls the respondSharedOrder RPC.
 *
 * Requirements: 7.1, 7.4, 7.10, 7.12, 7.13, 8.6
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { respondSharedOrder } from '@/features/orders/shared-order-workflow';
import { validateCashAccountForAcceptance } from '../validation';
import { useCashAccountsForUser } from '../hooks/useCashAccountsForUser';
import { CashAccountSelector } from './CashAccountSelector';

interface AcceptOrderModalProps {
  orderId: string;
  receiveCurrency: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AcceptOrderModal({
  orderId,
  receiveCurrency,
  isOpen,
  onClose,
  onSuccess,
}: AcceptOrderModalProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const { userId } = useAuth();
  const { accounts } = useCashAccountsForUser();

  const acceptMutation = useMutation({
    mutationFn: async () => {
      // Client-side validation
      const validation = validateCashAccountForAcceptance(
        selectedAccountId,
        userId ?? '',
        receiveCurrency,
        accounts,
      );

      if (!validation.valid) {
        throw new Error(validation.reason ?? 'Validation failed');
      }

      // Call the RPC — currently respondSharedOrder does not accept
      // destination_cash_account_id, so we pass the standard payload.
      // When the RPC is extended, add destination_cash_account_id here.
      const result = await respondSharedOrder({
        orderId,
        actorRole: 'customer',
        action: 'approve',
      });

      return result;
    },
    onSuccess: () => {
      toast.success('Order approved successfully');
      setSelectedAccountId(null);
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      if (error.message === 'wrong_owner') {
        toast.error(
          'This account does not belong to you. Please select another.',
        );
        setSelectedAccountId(null);
        return;
      }
      toast.error(error.message ?? 'Failed to approve order');
    },
  });

  const handleConfirm = () => {
    acceptMutation.mutate();
  };

  const handleClose = () => {
    if (!acceptMutation.isPending) {
      setSelectedAccountId(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Accept Order</DialogTitle>
          <DialogDescription>
            Select a cash account to receive the {receiveCurrency} proceeds.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <CashAccountSelector
            selectedAccountId={selectedAccountId}
            onSelect={setSelectedAccountId}
            expectedCurrency={receiveCurrency}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={acceptMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedAccountId || acceptMutation.isPending}
          >
            {acceptMutation.isPending ? 'Approving…' : 'Accept'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
