package derive

// Per-agent KPI over a 7 or 30 day window.
//
// Everything here is computed from rows Hermes already stores (sessions and
// messages metadata). There is no estimation and no synthetic baseline: a
// metric whose source column is missing is published as null with an
// `available:false` flag, never as a zero that would read like "no activity".
//
// Cost is deliberately absent. state.db has no cost, model, prompt_tokens or
// completion_tokens column, so rupiah/dollar per agent cannot be measured. The
// payload says so with data.cost_available=false instead of pretending.

import (
	"sort"
	"time"

	"officeapi/internal/store"
)

// GapCapS is the largest idle gap counted in the lead-time figure. A gap
// overnight is not "latency between activities", it is a closed desk; capping
// at 6 h keeps one long pause from dominating the median.
const GapCapS = 6 * 3600

// KPI windows the endpoint accepts.
const (
	KPIWindow7d  = "7d"
	KPIWindow30d = "30d"
)

// ParseKPIWindow maps a query value to its length in days.
func ParseKPIWindow(v string) (int, bool) {
	switch v {
	case KPIWindow7d:
		return 7, true
	case KPIWindow30d:
		return 30, true
	default:
		return 0, false
	}
}

// TokenStats is the token block of one agent. Available=false means the window
// has no recorded token counts, so Total is null rather than 0.
type TokenStats struct {
	Available          bool `json:"available"`
	Total              *int `json:"total"`
	MessagesWithTokens int  `json:"messages_with_tokens"`
}

// AgentKPI is one desk's measured output for the window.
type AgentKPI struct {
	ID         string `json:"id"`
	Sessions   int    `json:"sessions"`
	Messages   int    `json:"messages"`
	ToolCalls  int    `json:"tool_calls"`
	ActiveDays int    `json:"active_days"`
	// ActiveHours counts distinct (day, hour) buckets with at least one message:
	// 09:00-09:59 on two days is two hours, not one.
	ActiveHours int `json:"active_hours"`
	// MedianGapS / P90GapS are the coarse lead time: seconds between two
	// consecutive messages of the same session, capped at GapCapS.
	MedianGapS *float64 `json:"median_gap_s"`
	P90GapS    *float64 `json:"p90_gap_s"`
	// ActiveSeconds is the summed span (last-first activity) of each session
	// clipped to the window; BlockedSeconds is the merged duration of runs of
	// >=2 consecutive failing tool results, each held at most BlockedHold.
	ActiveSeconds  int64 `json:"active_seconds"`
	BlockedSeconds int64 `json:"blocked_seconds"`
	// BlockedPct is 100*BlockedSeconds/ActiveSeconds, null when the window has
	// no measurable span.
	BlockedPct *float64   `json:"blocked_pct"`
	LastActive float64    `json:"last_active"`
	Tokens     TokenStats `json:"tokens"`
}

// KPITotals is the office-wide roll-up.
type KPITotals struct {
	Sessions       int        `json:"sessions"`
	Messages       int        `json:"messages"`
	ToolCalls      int        `json:"tool_calls"`
	ActiveAgents   int        `json:"active_agents"`
	ActiveSeconds  int64      `json:"active_seconds"`
	BlockedSeconds int64      `json:"blocked_seconds"`
	BlockedPct     *float64   `json:"blocked_pct"`
	Tokens         TokenStats `json:"tokens"`
}

// KPIData describes how complete the measurement is.
type KPIData struct {
	ProfilesRead   int      `json:"profiles_read"`
	ProfilesOK     int      `json:"profiles_ok"`
	ProfilesErr    int      `json:"profiles_err"`
	ProfilesFailed []string `json:"profiles_failed,omitempty"`
	// MessagesCapped is true when a profile hit the per-profile message cap, so
	// the window is a lower bound rather than the full history.
	MessagesCapped bool `json:"messages_capped"`
	// TokenColumn says whether any state.db exposed a token column. When false,
	// token counts cannot exist at all — the UI must say "not recorded", never 0.
	TokenColumn bool `json:"token_column"`
	// CostAvailable is always false with the current schema: there is no model
	// price or per-message cost column to compute it from.
	CostAvailable bool `json:"cost_available"`
}

// KPIReport is GET /api/kpi.
type KPIReport struct {
	Window      string     `json:"window"`
	From        float64    `json:"from"`
	To          float64    `json:"to"`
	GeneratedAt float64    `json:"generated_at"`
	CacheTTLS   int        `json:"cache_ttl_s"`
	Agents      []AgentKPI `json:"agents"`
	Totals      KPITotals  `json:"totals"`
	Data        KPIData    `json:"data"`
}

type kpiBucket struct {
	messages   int
	toolCalls  int
	days       map[string]bool
	hours      map[string]bool
	gaps       []float64
	activeSecs int64
	blocked    int64
	last       float64
	tokens     int
	tokenMsgs  int
	hasTokens  bool
	sessions   map[string]bool
}

// BuildKPI aggregates a dataset over windowDays. Pure: same input, same output.
func BuildKPI(ds Dataset, windowDays int) KPIReport {
	to := ds.Now
	from := to - float64(windowDays)*86400
	if windowDays <= 0 {
		windowDays = 7
		from = to - 7*86400
	}
	loc := ds.Location
	if loc == nil {
		loc = time.FixedZone("WIB", wibOffset)
	}

	works, byID := prepare(ds)
	buckets := map[string]*kpiBucket{}
	get := func(id string) *kpiBucket {
		b := buckets[id]
		if b == nil {
			b = &kpiBucket{days: map[string]bool{}, hours: map[string]bool{}, sessions: map[string]bool{}}
			buckets[id] = b
		}
		return b
	}

	// Sessions that started inside the window count even when they have no
	// message rows (a session can be opened and closed empty).
	for _, w := range works {
		if w.sess.Started >= from && w.sess.Started <= to {
			get(w.owner).sessions[w.sess.ID] = true
		}
	}

	for _, p := range ds.Profiles {
		bySess := map[string][]store.Msg{}
		for _, m := range p.Msgs {
			bySess[m.SessionID] = append(bySess[m.SessionID], m)
		}
		for sid, msgs := range bySess {
			owner := p.Name
			if w, ok := byID[sid]; ok && w.owner != "" {
				owner = w.owner
			}
			b := get(owner)
			inWin := make([]store.Msg, 0, len(msgs))
			for _, m := range msgs {
				if m.TS < from || m.TS > to {
					continue
				}
				inWin = append(inWin, m)
				b.sessions[sid] = true
				b.messages++
				if m.Role != "tool" && m.Role != "tool_result" && len(m.Tools) > 0 {
					b.toolCalls += len(m.Tools)
				}
				t := time.Unix(int64(m.TS), 0).In(loc)
				b.days[t.Format("2006-01-02")] = true
				b.hours[t.Format("2006-01-02T15")] = true
				if m.TS > b.last {
					b.last = m.TS
				}
				if m.Tokens > 0 {
					b.tokens += m.Tokens
					b.tokenMsgs++
					b.hasTokens = true
				}
			}
			if len(inWin) == 0 {
				continue
			}
			first, last := inWin[0].TS, inWin[len(inWin)-1].TS
			if last > first {
				b.activeSecs += int64(last - first)
				for i := 1; i < len(inWin); i++ {
					if gap := inWin[i].TS - inWin[i-1].TS; gap > 0 && gap <= GapCapS {
						b.gaps = append(b.gaps, gap)
					}
				}
			}
			b.blocked += blockedSeconds(inWin)
		}
	}

	ids := kpiIDs(ds, buckets)
	agents := make([]AgentKPI, 0, len(ids))
	for _, id := range ids {
		b := buckets[id]
		a := AgentKPI{ID: id}
		if b != nil {
			a.Sessions = len(b.sessions)
			a.Messages = b.messages
			a.ToolCalls = b.toolCalls
			a.ActiveDays = len(b.days)
			a.ActiveHours = len(b.hours)
			a.ActiveSeconds = b.activeSecs
			a.BlockedSeconds = b.blocked
			a.LastActive = b.last
			a.MedianGapS = percentile(b.gaps, 50)
			a.P90GapS = percentile(b.gaps, 90)
			if b.activeSecs > 0 {
				pct := 100 * float64(b.blocked) / float64(b.activeSecs)
				if pct > 100 {
					pct = 100
				}
				a.BlockedPct = &pct
			}
			a.Tokens = TokenStats{MessagesWithTokens: b.tokenMsgs}
			if b.hasTokens {
				total := b.tokens
				a.Tokens.Available = true
				a.Tokens.Total = &total
			}
		}
		agents = append(agents, a)
	}
	sort.SliceStable(agents, func(i, j int) bool {
		if agents[i].Messages != agents[j].Messages {
			return agents[i].Messages > agents[j].Messages
		}
		if agents[i].LastActive != agents[j].LastActive {
			return agents[i].LastActive > agents[j].LastActive
		}
		return agents[i].ID < agents[j].ID
	})

	return KPIReport{
		Window:      windowKey(windowDays),
		From:        from,
		To:          to,
		GeneratedAt: to,
		CacheTTLS:   60,
		Agents:      agents,
		Totals:      totals(agents),
		Data: KPIData{
			ProfilesRead:   ds.DBsChecked,
			ProfilesOK:     ds.DBsOK,
			ProfilesErr:    ds.DBsErr,
			ProfilesFailed: ds.DBsFailed,
			MessagesCapped: ds.MessagesCapped,
			TokenColumn:    ds.TokenColumn,
			CostAvailable:  false,
		},
	}
}

func windowKey(days int) string {
	if days == 30 {
		return KPIWindow30d
	}
	return KPIWindow7d
}

func kpiIDs(ds Dataset, buckets map[string]*kpiBucket) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ds.ProfileNames)+len(buckets))
	for _, n := range ds.ProfileNames {
		if n != "" && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	var extra []string
	for id := range buckets {
		if !seen[id] {
			seen[id] = true
			extra = append(extra, id)
		}
	}
	sort.Strings(extra)
	return append(out, extra...)
}

func totals(agents []AgentKPI) KPITotals {
	var t KPITotals
	var blocked int64
	var active int64
	tokens := 0
	tokenMsgs := 0
	tokensSeen := false
	for _, a := range agents {
		t.Sessions += a.Sessions
		t.Messages += a.Messages
		t.ToolCalls += a.ToolCalls
		active += a.ActiveSeconds
		blocked += a.BlockedSeconds
		if a.Messages > 0 {
			t.ActiveAgents++
		}
		if a.Tokens.Available && a.Tokens.Total != nil {
			tokens += *a.Tokens.Total
			tokenMsgs += a.Tokens.MessagesWithTokens
			tokensSeen = true
		}
	}
	t.ActiveSeconds, t.BlockedSeconds = active, blocked
	if active > 0 {
		pct := 100 * float64(blocked) / float64(active)
		if pct > 100 {
			pct = 100
		}
		t.BlockedPct = &pct
	}
	t.Tokens = TokenStats{Available: tokensSeen, MessagesWithTokens: tokenMsgs}
	if tokensSeen {
		t.Tokens.Total = &tokens
	}
	return t
}

// percentile returns the nearest-rank percentile of vals, or nil when there is
// not enough data to be meaningful (fewer than two gaps).
func percentile(vals []float64, p int) *float64 {
	if len(vals) < 2 {
		return nil
	}
	s := append([]float64(nil), vals...)
	sort.Float64s(s)
	rank := (p*len(s) + 99) / 100 // ceil(p/100 * n)
	if rank < 1 {
		rank = 1
	}
	if rank > len(s) {
		rank = len(s)
	}
	v := s[rank-1]
	return &v
}

// blockedSeconds finds runs of >=2 consecutive failing tool results and sums
// their duration. A run ends at the next different message or after
// BlockedHold, matching the live /api/status blocked verdict.
func blockedSeconds(msgs []store.Msg) int64 {
	var total int64
	fails := 0
	var start float64
	closeRun := func(end float64) {
		if fails < 2 {
			return
		}
		if end > start {
			total += int64(end - start)
		}
	}
	for _, m := range msgs {
		isToolResult := m.Role == "tool" || m.Role == "tool_result"
		if isToolResult && isToolError(m.Content) {
			if fails == 0 {
				start = m.TS
			}
			fails++
			continue
		}
		if fails > 0 && m.Role == "assistant" && len(m.Tools) > 0 {
			continue // the call that produced the failure
		}
		if fails > 0 {
			end := m.TS
			if end > start+BlockedHold {
				end = start + BlockedHold
			}
			closeRun(end)
			fails = 0
		}
	}
	if fails >= 2 {
		closeRun(start + BlockedHold)
	}
	return total
}
