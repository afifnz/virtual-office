import { useMemo, useState } from 'react'
import { useKPI } from '../hooks/useKPI'
import { agentMeta } from '../lib/roster'
import { compact } from '../lib/format'
import type { KpiAgent, KpiWindowKey } from '../lib/types'

const WINDOWS: Array<{ key: KpiWindowKey; label: string }> = [
  { key: '7d', label: '7 hari' },
  { key: '30d', label: '30 hari' },
]

/** Clock-ish duration: 45dtk, 12mnt, 3,4j. */
function dur(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}dtk`
  if (sec < 3600) return `${Math.round(sec / 60)}mnt`
  return `${(sec / 3600).toFixed(1).replace('.', ',')}j`
}

/** "4,2rb pesan" without the unit — compact() already shortens. */
function num(n: number): string {
  return compact(n)
}

function Row({ agent, max }: { agent: KpiAgent; max: number }) {
  const meta = agentMeta(agent.id)
  const width = max > 0 ? Math.max(2, Math.round((agent.messages / max) * 100)) : 0
  const blocked = agent.blocked_pct !== null && agent.blocked_pct >= 10
  return (
    <li className={`kpi-row ${blocked ? 'is-blocked' : ''}`}>
      <span className="kpi-name" title={`${meta.name} (${agent.id})`}>
        {meta.name}
      </span>
      <span
        className="kpi-track"
        role="img"
        aria-label={`${meta.name}: ${agent.messages} pesan`}
      >
        <i style={{ width: `${width}%` }} />
      </span>
      <b className="kpi-value">{num(agent.messages)}</b>
      <span className="kpi-sub">
        {agent.sessions} sesi · {agent.active_days} hari
        {agent.active_seconds > 0 ? ` · ${dur(agent.active_seconds)} aktif` : ''}
        {agent.blocked_pct !== null ? ` · terblokir ${Math.round(agent.blocked_pct)}%` : ''}
        {agent.median_gap_s !== null ? ` · jeda ${dur(agent.median_gap_s)}` : ''}
        {agent.tokens.available && agent.tokens.total !== null
          ? ` · ${compact(agent.tokens.total)} token`
          : ''}
      </span>
    </li>
  )
}

/**
 * KPI per agent. A centered panel on desktop, a full sheet on phones. It reads
 * /api/kpi only while open; the server caches each window for 60 s.
 */
export function KPI({ onClose, mobile }: { onClose: () => void; mobile: boolean }) {
  const [win, setWin] = useState<KpiWindowKey>('7d')
  const { data, error, loading, stale, refresh } = useKPI(win, true)

  // A report for the other window must never be labelled with the current one.
  const report = data && data.window === win ? data : null

  const agents = useMemo(
    () => (report?.agents ?? []).filter((a) => a.messages > 0 || a.sessions > 0),
    [report],
  )
  const max = agents.reduce((m, a) => Math.max(m, a.messages), 0)
  const silent = (report?.agents.length ?? 0) - agents.length
  const totals = report?.totals

  return (
    <section className={`kpi ${mobile ? 'is-full' : ''}`} aria-label="KPI per agen">
      <div className="panel-head">
        <h2>
          KPI per agen <small>{win === '7d' ? '7 hari' : '30 hari'}</small>
        </h2>
        <div className="tabs" role="tablist" aria-label="Jendela KPI">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              role="tab"
              aria-selected={win === w.key}
              className={win === w.key ? 'is-active' : ''}
              onClick={() => setWin(w.key)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn small" onClick={onClose} aria-label="Tutup KPI">
          ✕
        </button>
      </div>

      <div className="kpi-body">
        {!report && !error ? <p className="kpi-empty">memuat KPI…</p> : null}

        {!report && error ? (
          <div className="kpi-empty">
            <p>KPI tidak tersedia</p>
            <small>{error}</small>
            <button type="button" className="filter" onClick={refresh}>
              coba lagi
            </button>
          </div>
        ) : null}

        {report && totals ? (
          <>
            <div className="kpi-numbers">
              <div className="kpi-num">
                <b>{num(totals.messages)}</b>
                <span>pesan</span>
              </div>
              <div className="kpi-num">
                <b>{num(totals.sessions)}</b>
                <span>sesi</span>
              </div>
              <div className="kpi-num">
                <b>{num(totals.tool_calls)}</b>
                <span>alat</span>
              </div>
              <div className="kpi-num">
                <b>
                  {totals.active_agents}/{report.agents.length}
                </b>
                <span>agen aktif</span>
              </div>
              <div className="kpi-num">
                <b>{totals.blocked_pct === null ? '—' : `${Math.round(totals.blocked_pct)}%`}</b>
                <span>terblokir</span>
              </div>
            </div>

            {agents.length === 0 ? (
              <p className="kpi-empty">belum ada aktivitas pada jendela ini</p>
            ) : (
              <>
                <ol className="kpi-list">
                  {agents.map((a) => (
                    <Row key={a.id} agent={a} max={max} />
                  ))}
                </ol>
                <p className="kpi-caption">
                  batang = pesan per profil · {agents.length} meja aktif
                  {silent > 0 ? ` · ${silent} meja tanpa aktivitas` : ''}
                </p>
              </>
            )}

            <p className="kpi-note">
              {report.data.token_column
                ? report.totals.tokens.available
                  ? `Token dari kolom messages.tokens (${num(report.totals.tokens.total ?? 0)} tercatat).`
                  : 'Kolom token ada, tetapi tidak ada nilai pada jendela ini.'
                : 'Token tidak tercatat di state.db.'}{' '}
              Biaya rupiah/dolar per agen <b>belum terukur</b>: state.db tidak menyimpan harga
              model per pesan, jadi angka biaya tidak ditampilkan sebagai nol.
              {report.data.messages_capped
                ? ' Jumlah pesan adalah batas bawah (satu profil mencapai batas baca).'
                : ''}
            </p>
          </>
        ) : null}

        {report && stale ? (
          <p className="kpi-stale">data lama — gagal memperbarui{loading ? '…' : ''}</p>
        ) : null}
      </div>
    </section>
  )
}
