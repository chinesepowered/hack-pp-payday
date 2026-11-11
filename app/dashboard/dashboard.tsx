'use client';

// The operator's live payouts dashboard: one AG Studio instance inside the Payday shell. Studio's
// configuration (data sources, theme, report pages, custom widgets, the auditor agent) lives in
// ./studio. The shell owns the layout presets, edit mode and saving; Studio owns the report.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AgStudioAiModule, enableStudioDevValidations, type AgReportState, type AgStudioApi, type AgStudioMode } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { Rio } from '@/components/rio';
import { Button, cx } from '@/components/ui';
import { api as call, shortModel } from '@/lib/client';
import type { PublicState } from '@/lib/view';
import { buildAi } from './studio/auditor';
import { buildStudioData } from './studio/data';
import { defaultReport, PAGES } from './studio/report';
import { paydayStudioTheme } from './studio/theme';
import { paydayWidgets, type DashStore } from './studio/widgets';

if (process.env.NODE_ENV !== 'production') enableStudioDevValidations();

const SAVE_KEY = 'payday.dashboard.v3';
const noSubscription = () => () => {};

function createStore(initial: PublicState): DashStore & { set: (s: PublicState) => void } {
  let current = initial;
  const listeners = new Set<() => void>();
  const store = {
    get: () => current,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set: (s: PublicState) => {
      current = s;
      listeners.forEach((l) => l());
    },
    reload: async () => {
      store.set(await call<PublicState>('/api/state'));
    },
  };
  return store;
}

export function Dashboard(props: { initial: PublicState; licenseKey?: string; aiModels?: string[] }) {
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  if (!inBrowser) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-pd-muted" role="status">
        <Rio pose="idle" size={96} className="pd-pulse" />
        Loading the dashboard
      </div>
    );
  }
  return <StudioDashboard {...props} />;
}

function StudioDashboard({ initial, licenseKey, aiModels }: { initial: PublicState; licenseKey?: string; aiModels?: string[] }) {
  const [store] = useState(() => createStore(initial));
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const apiRef = useRef<AgStudioApi | null>(null);
  const [mode, setMode] = useState<AgStudioMode>('view');
  const [pageId, setPageId] = useState('overview');
  const [saved, setSaved] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [initialState] = useState<AgReportState>(() => {
    try {
      const stored = window.localStorage.getItem(SAVE_KEY);
      if (stored) return JSON.parse(stored) as AgReportState;
    } catch {}
    return defaultReport;
  });

  const data = useMemo(() => buildStudioData(state), [state]);
  // `ai` and `context` are read once, when Studio is created.
  const ai = useMemo(() => (aiModels?.length ? buildAi(aiModels, store) : undefined), [aiModels, store]);
  const context = useMemo(() => ({ store }), [store]);

  // Live data: poll the app state (which re-reads pending payouts from PayPal).
  const refresh = useCallback(
    async (all = false) => {
      try {
        store.set(await call<PublicState>(`/api/state?refresh=${all ? 'all' : '1'}`));
      } catch {}
    },
    [store],
  );
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  const selectPage = (id: string) => {
    const studio = apiRef.current;
    if (!studio) return;
    const current = studio.getState();
    if (current.pages.some((p) => p.id === id)) studio.setState({ ...current, selectedPageId: id });
    setPageId(id);
  };
  // The auditor's chat lives in Studio's AI panel, which Studio shows in edit mode.
  const askAuditor = () => {
    const studio = apiRef.current;
    if (!studio) return;
    setMode('edit');
    // Studio opens its edit panels when the mode changes, so the panel state is set just after.
    setTimeout(() => {
      const current = studio.getState();
      studio.setState({ ...current, panels: { ...current.panels, ai: { collapsed: false, width: 460 }, edit: { collapsed: true }, data: { collapsed: true }, filters: { collapsed: true } } });
    }, 250);
  };
  const save = () => {
    const studio = apiRef.current;
    if (!studio) return;
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(studio.getState()));
    setSaved('Layout saved in this browser.');
  };
  const reset = () => {
    window.localStorage.removeItem(SAVE_KEY);
    apiRef.current?.setState({ ...defaultReport, selectedPageId: pageId });
    apiRef.current?.clearHistory();
    setSaved('Layout reset to the built-in presets.');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-pd-border bg-white px-4 py-2">
        <div className="mr-2">
          <h1 className="text-lg font-extrabold leading-tight">Payouts dashboard</h1>
          <p className="text-xs text-pd-muted">
            TidyNest, live from the PayPal sandbox. Built with AG Studio.
            {aiModels?.length ? ` Auditor model: ${shortModel(aiModels[0])}.` : ''}
          </p>
        </div>
        <div role="tablist" aria-label="Layout presets" className="flex rounded-lg border border-pd-border p-0.5">
          {PAGES.map((p) => (
            <button
              key={p.id}
              role="tab"
              type="button"
              aria-selected={pageId === p.id}
              onClick={() => selectPage(p.id)}
              data-testid={`preset-${p.id}`}
              className={cx('min-h-9 rounded-md px-3 text-sm font-semibold', pageId === p.id ? 'bg-pd-ink text-white' : 'text-pd-muted hover:bg-pd-highlight')}
            >
              {p.title}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span aria-live="polite" className="text-xs text-pd-muted">{saved}</span>
          <Button
            small
            variant="secondary"
            busy={refreshing}
            data-testid="dash-refresh"
            onClick={async () => {
              setRefreshing(true);
              await refresh(true);
              setRefreshing(false);
            }}
          >
            Refresh from PayPal
          </Button>
          {mode === 'edit' && (
            <>
              <Button small variant="secondary" onClick={() => apiRef.current?.undo()}>Undo</Button>
              <Button small variant="secondary" onClick={reset}>Reset layout</Button>
              <Button small onClick={save} data-testid="dash-save">Save layout</Button>
            </>
          )}
          {ai && (
            <Button small onClick={askAuditor} data-testid="ask-auditor" className="bg-pd-ink hover:bg-pd-ink">
              Ask the auditor
            </Button>
          )}
          <Button small variant={mode === 'edit' ? 'primary' : 'secondary'} aria-pressed={mode === 'edit'} onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')} data-testid="dash-edit">
            {mode === 'edit' ? 'Done editing' : 'Edit layout'}
          </Button>
        </div>
      </div>

      <div style={{ height: 'calc(100dvh - 120px)', minHeight: 640, flex: 'none' }} data-testid="studio">
        <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio
            style={{ height: '100%', width: '100%' }}
            theme={paydayStudioTheme}
            layout={{ widgetBorderEnabled: true }}
            panels={{ edit: { left: ['edit', 'data'], right: ['ai', 'filters'] }, view: { right: ['filters'] } }}
            data={data}
            widgets={paydayWidgets}
            context={context}
            ai={ai}
            initialState={initialState}
            mode={mode}
            onApiReady={(event) => {
              apiRef.current = event.api;
            }}
            onStudioReady={(event) => setPageId(event.api.getState().selectedPageId ?? 'overview')}
            onStateUpdated={(event) => setPageId(event.state.selectedPageId ?? 'overview')}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
