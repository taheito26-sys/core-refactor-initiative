/**
 * AdminSettings — App-wide settings toggles for the admin panel.
 * Currently supports: Welcome Message toggle (on/off) + duration (seconds).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

interface ConfigRow {
  key: string;
  value: boolean | number;
  updated_at: string;
}

function useAppConfig(key: string) {
  return useQuery({
    queryKey: ['app-config', key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_config')
        .select('key, value, updated_at')
        .eq('key', key)
        .single();
      if (error) return null;
      return data as ConfigRow;
    },
  });
}

export function AdminSettings() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const { data: welcomeCfg, isLoading } = useAppConfig('welcome_message_enabled');
  const { data: durationCfg, isLoading: isDurationLoading } = useAppConfig('welcome_message_duration_s');

  const isEnabled = welcomeCfg?.value !== false;
  const currentDuration = typeof durationCfg?.value === 'number' ? durationCfg.value : 4;
  const [durationInput, setDurationInput] = useState<string>('');

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from('app_config')
        .upsert({
          key: 'welcome_message_enabled',
          value: enabled,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        }, { onConflict: 'key' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-config', 'welcome_message_enabled'] });
      toast.success('Setting updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const durationMutation = useMutation({
    mutationFn: async (seconds: number) => {
      const { error } = await supabase
        .from('app_config')
        .upsert({
          key: 'welcome_message_duration_s',
          value: seconds,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        }, { onConflict: 'key' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-config', 'welcome_message_duration_s'] });
      setDurationInput('');
      toast.success('Duration updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDurationSave = () => {
    const val = parseFloat(durationInput);
    if (!Number.isFinite(val) || val < 1 || val > 30) {
      toast.error('Enter a value between 1 and 30 seconds');
      return;
    }
    durationMutation.mutate(val);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Section header */}
      <div style={{
        fontSize: 9, fontWeight: 400, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--tracker-muted)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        App Settings
        <div style={{ flex: 1, height: 1, background: 'var(--tracker-line)' }} />
      </div>

      {/* Welcome Message Toggle */}
      <div style={{
        padding: '16px 20px',
        background: 'var(--tracker-panel)',
        border: '1px solid var(--tracker-line)',
        borderRadius: 'var(--lt-radius)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {/* Toggle row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 32, height: 32,
              borderRadius: 'var(--lt-radius-sm)',
              background: 'color-mix(in srgb, var(--tracker-brand) 12%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MessageSquare style={{ width: 15, height: 15, color: 'var(--tracker-brand)' }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--tracker-text)' }}>
                Welcome Message
              </div>
              <div style={{ fontSize: 10, color: 'var(--tracker-muted)', marginTop: 2 }}>
                Show a random motivational welcome message when users open the app.
                Applies to all merchants and customers.
              </div>
            </div>
          </div>

          {isLoading ? (
            <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite', color: 'var(--tracker-muted)' }} />
          ) : (
            <button
              onClick={() => toggleMutation.mutate(!isEnabled)}
              disabled={toggleMutation.isPending}
              style={{
                width: 48, height: 26,
                borderRadius: 13,
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
                background: isEnabled
                  ? 'var(--tracker-good, #22c55e)'
                  : 'color-mix(in srgb, var(--tracker-muted) 30%, transparent)',
                flexShrink: 0,
              }}
            >
              <div style={{
                width: 20, height: 20,
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: 3,
                left: isEnabled ? 25 : 3,
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
          )}
        </div>

        {/* Duration row — only shown when enabled */}
        {isEnabled && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--tracker-line)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--tracker-text)' }}>
                Display Duration
              </div>
              <div style={{ fontSize: 10, color: 'var(--tracker-muted)', marginTop: 2 }}>
                How long the message stays on screen (1–30 seconds).
                {!isDurationLoading && (
                  <span style={{ color: 'var(--tracker-brand)', marginLeft: 6 }}>
                    Current: {currentDuration}s
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <input
                type="number"
                min={1}
                max={30}
                placeholder={String(currentDuration)}
                value={durationInput}
                onChange={e => setDurationInput(e.target.value)}
                style={{
                  width: 64,
                  padding: '5px 8px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--tracker-line)',
                  background: 'var(--tracker-card-bg)',
                  color: 'var(--tracker-text)',
                  outline: 'none',
                  textAlign: 'center',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--tracker-muted)' }}>sec</span>
              <button
                onClick={handleDurationSave}
                disabled={durationMutation.isPending || !durationInput}
                style={{
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'var(--tracker-brand)',
                  color: '#fff',
                  opacity: durationMutation.isPending || !durationInput ? 0.5 : 1,
                }}
              >
                {durationMutation.isPending ? '...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
