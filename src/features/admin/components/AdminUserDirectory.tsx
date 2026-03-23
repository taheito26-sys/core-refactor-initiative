import { useState } from 'react';
import { format } from 'date-fns';
import { Search, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminUsers } from '../hooks/useAdminUsers';

interface Props {
  onOpenWorkspace: (userId: string) => void;
}

const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  approved: 'default',
  pending: 'outline',
  rejected: 'destructive',
};

export function AdminUserDirectory({ onOpenWorkspace }: Props) {
  const [search, setSearch] = useState('');
  const { data: users, isLoading } = useAdminUsers(search);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-foreground">User Directory</h2>
        <div className="relative flex-1 max-w-sm ml-auto">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search email, merchant ID, name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : !users?.length ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No users found.</p>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Display Name</TableHead>
                <TableHead className="text-xs">Merchant ID</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Registered</TableHead>
                <TableHead className="text-xs text-right">Deals</TableHead>
                <TableHead className="text-xs text-right">Profit</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.user_id}>
                  <TableCell className="text-xs font-medium">{u.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.display_name ?? '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{u.merchant_id ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={statusColors[u.status] ?? 'secondary'} className="text-[10px]">
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(u.created_at), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="text-xs text-right">{u.deal_count}</TableCell>
                  <TableCell className="text-xs text-right">
                    {u.total_profit > 0 ? `${u.total_profit.toLocaleString()}` : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onOpenWorkspace(u.user_id)}>
                      <ExternalLink className="h-3 w-3 mr-1" /> Inspect
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
