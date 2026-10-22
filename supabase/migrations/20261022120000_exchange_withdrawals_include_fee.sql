-- An outgoing on-chain transfer is recorded at the full amount that left the
-- wallet: the withdrawal amount the exchange reports plus the network fee it
-- charged on top (Binance `transactionFee`, OKX `fee`). exchange-sync now
-- stores it that way; this brings rows synced before the change into line.
-- It recomputes from the stored raw payload, so running it again changes nothing.

update public.exchange_transfers
set amount = coalesce(nullif(raw->>'amount', '')::numeric, 0)
           + abs(coalesce(nullif(raw->>'transactionFee', '')::numeric, 0))
where exchange = 'binance'
  and kind = 'network'
  and direction = 'out'
  and raw ? 'amount';

update public.exchange_transfers
set amount = coalesce(nullif(raw->>'amt', '')::numeric, 0)
           + abs(coalesce(nullif(raw->>'fee', '')::numeric, 0))
where exchange = 'okx'
  and kind = 'network'
  and direction = 'out'
  and raw ? 'amt';
