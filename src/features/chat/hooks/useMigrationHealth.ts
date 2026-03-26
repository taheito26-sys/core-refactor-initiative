import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { migrationHealth, runLegacyMigration } from '@/features/chat/api/migration';

export function useMigrationHealth() {
  const qc = useQueryClient();

  const health = useQuery({
    queryKey: ['chat', 'migration-health'],
    queryFn: async () => {
      const res = await migrationHealth();
      if (!res.ok) throw new Error(res.error ?? 'Migration health failed');
      return res.data;
    },
  });

  const runDry = useMutation({
    mutationFn: async () => {
      const res = await runLegacyMigration(true);
      if (!res.ok) throw new Error(res.error ?? 'Dry migration failed');
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat', 'migration-health'] }),
  });

  const runLive = useMutation({
    mutationFn: async () => {
      const res = await runLegacyMigration(false);
      if (!res.ok) throw new Error(res.error ?? 'Live migration failed');
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat', 'migration-health'] }),
  });

  return { health, runDry, runLive };
}
