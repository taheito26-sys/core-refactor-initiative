import { useState } from 'react';
import { format } from 'date-fns';
import { Search, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdminAuditLogs, type AuditLogRow } from '../hooks/useAdminAudit';

const actionColors: Record<string, string> = {
  correct_deal: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  void_deal: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  approve_user: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  reject_user: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

export function AdminAuditCenter() {
  const [search, setSearch] = useState('');
  const { data: logs, isLoading } = useAdminAuditLogs(search);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-foreground">Audit Center</h2>
        <div className="relative flex-1 max-w-sm ml-auto">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search action, target, admin…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !logs?.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">No audit records.</p>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Timestamp</TableHead>
                <TableHead className="text-xs">Action</TableHead>
                <TableHead className="text-xs">Target Type</TableHead>
                <TableHead className="text-xs">Target ID</TableHead>
                <TableHead className="text-xs">Admin</TableHead>
                <TableHead className="text-xs text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
                  </TableCell>
                  <TableCell>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${actionColors[log.action] ?? 'bg-muted text-muted-foreground'}`}>
                      {log.action}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">{log.target_type}</TableCell>
                  <TableCell className="text-xs font-mono">{log.target_id?.slice(0, 8) ?? '—'}</TableCell>
                  <TableCell className="text-xs font-mono">{log.admin_user_id.slice(0, 8)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setDetail(log)}>
                      <FileText className="h-3 w-3 mr-1" /> View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={open => !open && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Audit Detail — {detail?.action}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto whitespace-pre-wrap break-all">
              {detail?.details ? JSON.stringify(detail.details, null, 2) : 'No details.'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
