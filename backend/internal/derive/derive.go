// Package derive turns raw Hermes session/message rows into the office JSON
// contract: now, gateway, agents, feed, tasks, comms.
//
// Everything here is metadata only. Message content is inspected locally to
// classify an event (tool error / delegation result) and is never emitted.
package derive

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"officeapi/internal/store"
)

// Timing rules (kept identical to the original Python API).
const (
	ActiveMsgWindow = 20.0    // a message this fresh means the session is live
	MidTurnWindow   = 15 * 60 // mid-turn (last role user/tool) counts as active
	BlockedHold     = 30 * 60 // a blocked verdict stands this long
	FeedLimit       = 40
	TaskLimit       = 40
	CommsLimit      = 30
	HourlyBuckets   = 24
	wibOffset       = 7 * 3600 // the office clock runs on WIB
)

// Reviewers report "reviewing" instead of "working" while active.
var Reviewers = map[string]bool{
	"reviewer":     true,
	"edu-reviewer": true,
}

// Gateway is the gateway_state.json projection.
type Gateway struct {
	State     string `json:"state"`
	Version   string `json:"version"`
	UpdatedAt string `json:"updated_at"`
}

// Current is the live activity of an agent.
type Current struct {
	Kind  string   `json:"kind"`
	Tools []string `json:"tools"`
}

// Blocked explains a blocked agent.
type Blocked struct {
	Reason string  `json:"reason"`
	Since  float64 `json:"since"`
	Tools  int     `json:"tools"`
}

// Today is the per-day counter block.
type Today struct {
	Sessions  int   `json:"sessions"`
	Messages  int   `json:"messages"`
	ToolCalls int   `json:"tool_calls"`
	Tokens    int   `json:"tokens"`
	Hourly    []int `json:"hourly"`
}

// Total is the all-time counter block.
type Total struct {
	Sessions int `json:"sessions"`
	Messages int `json:"messages"`
}

// Agent is one desk.
type Agent struct {
	ID         string   `json:"id"`
	Status     string   `json:"status"`
	LastActive float64  `json:"last_active"`
	Current    *Current `json:"current"`
	Today      Today    `json:"today"`
	Total      Total    `json:"total"`
	Task       *string  `json:"task"`
	Source     string   `json:"source"`
	Blocked    *Blocked `json:"blocked"`
}

// FeedEvent is one row of the activity feed.
type FeedEvent struct {
	Agent  string   `json:"agent"`
	TS     float64  `json:"ts"`
	Kind   string   `json:"kind"`
	Tools  []string `json:"tools"`
	Source string   `json:"source"`
}

// Task is a session seen as a work item.
type Task struct {
	ID       string   `json:"id"`
	Owner    string   `json:"owner"`
	From     string   `json:"from"`
	Via      string   `json:"via"`
	Status   string   `json:"status"`
	Blocked  *Blocked `json:"blocked"`
	Started  float64  `json:"started"`
	Last     float64  `json:"last"`
	Ended    *float64 `json:"ended"`
	Tools    int      `json:"tools"`
	Messages int      `json:"messages"`
}

// Comm is one metadata-only communication record.
type Comm struct {
	TS   float64 `json:"ts"`
	From string  `json:"from"`
	To   string  `json:"to"`
	Kind string  `json:"kind"`
	Task string  `json:"task"`
	Via  string  `json:"via,omitempty"`
}

// Snapshot is the full /api/status payload.
type Snapshot struct {
	Now     float64     `json:"now"`
	Gateway Gateway     `json:"gateway"`
	Agents  []Agent     `json:"agents"`
	Feed    []FeedEvent `json:"feed"`
	Tasks   []Task      `json:"tasks"`
	Comms   []Comm      `json:"comms"`
}

// ProfileData is everything loaded from one profile's state.db.
type ProfileData struct {
	Name     string
	Sessions []store.Session
	Msgs     []store.Msg
}

// Dataset is the loaded input for Build.
type Dataset struct {
	// ProfileNames is the full roster (configured profiles), so a profile with
	// no state.db still gets an offline desk.
	ProfileNames []string
	Profiles     []ProfileData
	Gateway      Gateway
	Now          float64
}

type sessionWork struct {
	sess      store.Session
	dbProfile string
	owner     string
	msgs      []store.Msg
	last      store.Msg
	hasMsg    bool
}

// Build derives the snapshot. Pure function: same input, same output.
func Build(ds Dataset) Snapshot {
	now := ds.Now
	works := make([]*sessionWork, 0, 64)
	byID := map[string]*sessionWork{}

	// index sessions, attach messages
	for _, p := range ds.Profiles {
		msgBySession := map[string][]store.Msg{}
		for _, m := range p.Msgs {
			msgBySession[m.SessionID] = append(msgBySession[m.SessionID], m)
		}
		for _, s := range p.Sessions {
			w := &sessionWork{sess: s, dbProfile: p.Name}
			w.msgs = msgBySession[s.ID]
			if n := len(w.msgs); n > 0 {
				w.last, w.hasMsg = w.msgs[n-1], true
			}
			works = append(works, w)
			byID[s.ID] = w
		}
	}

	// attribute each session to an agent profile
	for _, w := range works {
		w.owner = attribute(w, byID)
	}

	agents := buildAgents(ds, works, byID, now)
	feed := buildFeed(works, now)
	tasks := buildTasks(works, now)
	comms := buildComms(works, byID, now)

	return Snapshot{
		Now:     now,
		Gateway: ds.Gateway,
		Agents:  agents,
		Feed:    feed,
		Tasks:   tasks,
		Comms:   comms,
	}
}

// attribute decides which agent a session belongs to. A subagent session lives
// in the parent's DB; when the parent's delegate_task call names a profile in
// tasks[i] (matched by model_config._subagent_id "sa-<i>-..."), the child desk
// owns the session. Otherwise the parent does.
func attribute(w *sessionWork, byID map[string]*sessionWork) string {
	s := w.sess
	if !strings.EqualFold(s.Source, "subagent") {
		if s.Profile != "" {
			return s.Profile
		}
		return w.dbProfile
	}
	parent := byID[s.ParentID]
	if parent == nil {
		return w.dbProfile
	}
	if tp := routedProfile(parent, subagentIndex(s.ModelConfig)); tp != "" {
		return tp
	}
	if parent.sess.Profile != "" && !strings.EqualFold(parent.sess.Source, "subagent") {
		return parent.dbProfile
	}
	return parent.dbProfile
}

// subagentIndex pulls i out of model_config._subagent_id = "sa-<i>-<id>".
func subagentIndex(modelConfig string) int {
	if modelConfig == "" {
		return -1
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(modelConfig), &cfg); err != nil {
		return -1
	}
	raw := ""
	for _, k := range []string{"_subagent_id", "subagent_id", "_task_id"} {
		if v, ok := cfg[k].(string); ok {
			raw = v
		}
	}
	if !strings.HasPrefix(raw, "sa-") {
		return -1
	}
	rest := strings.TrimPrefix(raw, "sa-")
	for i := 0; i < len(rest); i++ {
		if rest[i] < '0' || rest[i] > '9' {
			if i == 0 {
				return -1
			}
			n := 0
			for _, c := range rest[:i] {
				n = n*10 + int(c-'0')
			}
			return n
		}
	}
	return -1
}

type delegateCall struct {
	idx      int
	profile  string
	ts       float64
	childIDs []string
}

// delegateCalls parses every delegate_task tool call made in a session.
func delegateCalls(w *sessionWork) []delegateCall {
	var out []delegateCall
	for _, m := range w.msgs {
		if !hasTool(m.Tools, "delegate_task") {
			continue
		}
		for _, raw := range toolArgStrings(m, "delegate_task") {
			var payload struct {
				Action string `json:"action"`
				Tasks  []struct {
					Profile string `json:"profile"`
				} `json:"tasks"`
				Prompt   string `json:"prompt"`
				TargetID string `json:"subagent_id"`
			}
			if err := json.Unmarshal([]byte(raw), &payload); err != nil {
				continue
			}
			for i, t := range payload.Tasks {
				out = append(out, delegateCall{idx: i, profile: strings.TrimSpace(t.Profile), ts: m.TS})
			}
		}
	}
	return out
}

func routedProfile(parent *sessionWork, idx int) string {
	if idx < 0 {
		return ""
	}
	for _, c := range delegateCalls(parent) {
		if c.idx == idx && c.profile != "" {
			return c.profile
		}
	}
	return ""
}

func buildAgents(ds Dataset, works []*sessionWork, byID map[string]*sessionWork, now float64) []Agent {
	dayStart := wibDayStart(now)
	byAgent := map[string][]*sessionWork{}
	for _, w := range works {
		byAgent[w.owner] = append(byAgent[w.owner], w)
	}

	ids := make([]string, 0, len(ds.ProfileNames)+len(ds.Profiles))
	seen := map[string]bool{}
	for _, name := range ds.ProfileNames {
		if name != "" && !seen[name] {
			seen[name] = true
			ids = append(ids, name)
		}
	}
	for _, p := range ds.Profiles {
		if !seen[p.Name] {
			seen[p.Name] = true
			ids = append(ids, p.Name)
		}
	}
	// routed subagents can name a profile that has no DB of its own
	var extra []string
	for id := range byAgent {
		if !seen[id] {
			seen[id] = true
			extra = append(extra, id)
		}
	}
	sort.Strings(extra)
	ids = append(ids, extra...)

	agents := make([]Agent, 0, len(ids))
	for _, id := range ids {
		agents = append(agents, buildAgent(id, byAgent[id], now, dayStart))
	}
	return agents
}

func buildAgent(id string, ws []*sessionWork, now, dayStart float64) Agent {
	a := Agent{ID: id, Status: "offline", Today: Today{Hourly: make([]int, HourlyBuckets)}}
	if len(ws) == 0 {
		return a
	}
	var lastTS float64
	var live *sessionWork
	var liveTS float64

	for _, w := range ws {
		a.Total.Sessions++
		a.Total.Messages += len(w.msgs)
		if w.sess.Started >= dayStart {
			a.Today.Sessions++
		}
		for _, m := range w.msgs {
			if m.TS >= dayStart && m.TS < dayStart+86400 {
				a.Today.Messages++
				if len(m.Tools) > 0 || m.Role == "tool" {
					a.Today.ToolCalls++
				}
				a.Today.Tokens += m.Tokens
				slot := int((m.TS - dayStart) / 3600)
				if slot < 0 {
					slot = 0
				}
				if slot < HourlyBuckets {
					a.Today.Hourly[slot]++
				}
			}
			if m.TS > lastTS {
				lastTS = m.TS
			}
		}
		if w.hasMsg && (live == nil || w.last.TS > liveTS) {
			live, liveTS = w, w.last.TS
		}
	}
	a.LastActive = lastTS
	if a.LastActive == 0 {
		a.LastActive = 0
	}

	// status
	active := false
	for _, w := range ws {
		if w.hasMsg && isActive(w, now) {
			active = true
		}
	}
	switch {
	case active && Reviewers[id]:
		a.Status = "reviewing"
	case active:
		a.Status = "working"
	default:
		a.Status = "idle"
	}

	if live != nil {
		a.Current = &Current{Kind: eventKind(live, len(live.msgs)-1), Tools: nonNil(live.last.Tools)}
		a.Source = live.sess.Source
	}
	if a.Current != nil && len(a.Current.Tools) == 0 {
		a.Current.Tools = []string{}
	}

	// blocked from the newest session
	if newest := newestSession(ws); newest != nil {
		if b := blockedOf(newest, now); b != nil {
			a.Blocked = b
			a.Status = "blocked"
		}
	}
	// task pointer: newest running session
	if t := newestRunning(ws, now); t != nil {
		sid := shortID(t.sess.ID)
		a.Task = &sid
	}
	if a.Status == "offline" && a.LastActive > 0 {
		a.Status = "idle"
	}
	return a
}

func newestSession(ws []*sessionWork) *sessionWork {
	var best *sessionWork
	for _, w := range ws {
		if best == nil || sessionLast(w) > sessionLast(best) {
			best = w
		}
	}
	return best
}

func newestRunning(ws []*sessionWork, now float64) *sessionWork {
	var best *sessionWork
	for _, w := range ws {
		if !isRunning(w, now) {
			continue
		}
		if best == nil || sessionLast(w) > sessionLast(best) {
			best = w
		}
	}
	return best
}

func sessionLast(w *sessionWork) float64 {
	if w.hasMsg {
		return w.last.TS
	}
	if w.sess.Updated > 0 {
		return w.sess.Updated
	}
	return w.sess.Started
}

// isActive implements: last message < 20 s, or mid-turn < 15 min.
func isActive(w *sessionWork, now float64) bool {
	if !w.hasMsg {
		return false
	}
	last := w.last.TS
	if now-last < ActiveMsgWindow {
		return true
	}
	switch w.last.Role {
	case "user", "tool", "tool_call", "tool-call", "tool_use", "assistant_tool":
		if now-last < MidTurnWindow {
			return true
		}
	case "assistant":
		// an assistant turn ends the turn unless it carries tool calls
		if len(w.last.Tools) > 0 && now-last < MidTurnWindow {
			return true
		}
	}
	return false
}

func isRunning(w *sessionWork, now float64) bool {
	if isEnded(w) {
		return false
	}
	if w.hasMsg {
		return now-sessionLast(w) < MidTurnWindow
	}
	return true
}

func isEnded(w *sessionWork) bool { return w.sess.HasEnded }

// blockedOf applies the >=2 consecutive failing tool results / error end_reason
// rule, held 30 minutes.
func blockedOf(w *sessionWork, now float64) *Blocked {
	since := sessionLast(w)
	if now-since > BlockedHold {
		return nil
	}
	fails := 0
	for i := len(w.msgs) - 1; i >= 0; i-- {
		m := w.msgs[i]
		if m.Role != "tool" && m.Role != "tool_result" {
			if m.Role == "assistant" && len(m.Tools) > 0 {
				continue // the call that produced the failure
			}
			break
		}
		if !isToolError(m.Content) {
			break
		}
		fails++
	}
	if fails >= 2 {
		return &Blocked{Reason: plural(fails) + " tool gagal berturut", Since: since, Tools: fails}
	}
	if isErrorEnd(w.sess.EndReason) {
		return &Blocked{Reason: "sesi berakhir: " + store.SanitizeToken(w.sess.EndReason), Since: since, Tools: fails}
	}
	return nil
}

func isToolError(content string) bool {
	c := strings.TrimSpace(content)
	if strings.Contains(c, "[TOOL_ERROR]") {
		return true
	}
	low := strings.ToLower(c)
	if strings.HasPrefix(low, `{"error"`) || strings.HasPrefix(low, "{'error'") {
		return true
	}
	if strings.HasPrefix(low, "error:") || strings.HasPrefix(low, "error ") {
		return true
	}
	return false
}

func isErrorEnd(reason string) bool {
	r := strings.ToLower(strings.TrimSpace(reason))
	if r == "" || r == "ok" || r == "done" || r == "completed" || r == "success" || r == "user_stop" {
		return false
	}
	for _, k := range []string{"error", "fail", "timeout", "abort", "crash", "exception", "max_turns", "exceeded"} {
		if strings.Contains(r, k) {
			return true
		}
	}
	return false
}

// eventKind maps message i of a session to a feed kind.
func eventKind(w *sessionWork, i int) string {
	m := w.msgs[i]
	switch m.Role {
	case "user":
		c := strings.TrimSpace(m.Content)
		if strings.Contains(c, "ASYNC DELEGATION") {
			return "delegation_result"
		}
		if i == 0 {
			return "task"
		}
		return "request"
	case "assistant":
		if len(m.Tools) > 0 {
			return "tool"
		}
		return "reply"
	case "tool", "tool_result":
		return "tool_result"
	case "system":
		return ""
	default:
		if len(m.Tools) > 0 {
			return "tool"
		}
		return ""
	}
}

func buildFeed(works []*sessionWork, now float64) []FeedEvent {
	var ev []FeedEvent
	seen := map[string]bool{}
	for _, w := range works {
		for i, m := range w.msgs {
			k := eventKind(w, i)
			if k == "" {
				continue
			}
			key := w.owner + "|" + ftoa(m.TS) + "|" + k + "|" + strings.Join(m.Tools, ",")
			if seen[key] {
				continue
			}
			seen[key] = true
			ev = append(ev, FeedEvent{
				Agent:  w.owner,
				TS:     m.TS,
				Kind:   k,
				Tools:  nonNil(m.Tools),
				Source: w.sess.Source,
			})
		}
	}
	sort.SliceStable(ev, func(i, j int) bool { return ev[i].TS > ev[j].TS })
	if len(ev) > FeedLimit {
		ev = ev[:FeedLimit]
	}
	if ev == nil {
		ev = []FeedEvent{}
	}
	return ev
}

func buildTasks(works []*sessionWork, now float64) []Task {
	out := make([]Task, 0, len(works))
	for _, w := range works {
		status := "done"
		var ended *float64
		if isRunning(w, now) {
			status = "running"
		}
		if w.sess.HasEnded {
			ended = &w.sess.Ended
		}
		t := Task{
			ID:       shortID(w.sess.ID),
			Owner:    w.owner,
			From:     taskFrom(w),
			Via:      w.sess.Source,
			Status:   status,
			Started:  w.sess.Started,
			Last:     sessionLast(w),
			Ended:    ended,
			Messages: len(w.msgs),
		}
		if t.Via == "" {
			t.Via = "api"
		}
		for _, m := range w.msgs {
			if len(m.Tools) > 0 || m.Role == "tool" {
				t.Tools++
			}
		}
		if b := blockedOf(w, now); b != nil {
			t.Blocked = b
			t.Status = "blocked"
		}
		out = append(out, t)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Last > out[j].Last })
	if len(out) > TaskLimit {
		out = out[:TaskLimit]
	}
	return out
}

func taskFrom(w *sessionWork) string {
	if strings.EqualFold(w.sess.Source, "subagent") && w.sess.ParentID != "" {
		return shortID(w.sess.ParentID)
	}
	return "user"
}

func buildComms(works []*sessionWork, byID map[string]*sessionWork, now float64) []Comm {
	var out []Comm
	for _, w := range works {
		// request: first user message of a top-level session
		if !strings.EqualFold(w.sess.Source, "subagent") && w.hasMsg {
			for _, m := range w.msgs {
				if m.Role == "user" {
					out = append(out, Comm{TS: m.TS, From: "user", To: w.owner, Kind: "request",
						Task: shortID(w.sess.ID), Via: w.sess.Source})
					break
				}
			}
		}
		// delegate: delegate_task routed to a profile
		for _, c := range delegateCalls(w) {
			if c.profile == "" {
				continue
			}
			out = append(out, Comm{TS: c.ts, From: w.owner, To: c.profile, Kind: "delegate", Task: ""})
		}
		// steer
		for _, m := range w.msgs {
			if hasTool(m.Tools, "steer") {
				target := w.owner
				out = append(out, Comm{TS: m.TS, From: w.owner, To: target, Kind: "steer", Task: shortID(w.sess.ID)})
			}
		}
		// result / failed when a subagent session is over
		if strings.EqualFold(w.sess.Source, "subagent") && w.sess.HasEnded && w.sess.ParentID != "" {
			kind := "result"
			if isErrorEnd(w.sess.EndReason) {
				kind = "failed"
			}
			parent := byID[w.sess.ParentID]
			from := w.owner
			to := parent.owner
			if parent == nil {
				to = w.dbProfile
			}
			out = append(out, Comm{TS: w.sess.Ended, From: from, To: to, Kind: kind, Task: shortID(w.sess.ID)})
		}
	}
	// drop degenerate comms and sort newest first
	clean := out[:0]
	for _, c := range out {
		if c.From == "" || c.To == "" {
			continue
		}
		clean = append(clean, c)
	}
	out = clean
	sort.SliceStable(out, func(i, j int) bool { return out[i].TS > out[j].TS })
	if len(out) > CommsLimit {
		out = out[:CommsLimit]
	}
	if out == nil {
		out = []Comm{}
	}
	return out
}

// ---- small helpers ----

func wibDayStart(now float64) float64 {
	shifted := now + wibOffset
	day := shifted - float64(int(shifted)%86400)
	if day < 0 {
		day += 86400
	}
	return day - wibOffset
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func hasTool(tools []string, name string) bool {
	for _, t := range tools {
		if strings.EqualFold(t, name) {
			return true
		}
	}
	return false
}

func nonNil(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func plural(n int) string {
	if n == 1 {
		return "1"
	}
	return itoa(n)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func ftoa(f float64) string {
	return strconv.FormatFloat(f, 'f', 3, 64)
}

// toolArgStrings is defined in args.go (keeps store coupling in one place).
func toolArgStrings(m store.Msg, name string) []string {
	return store.ToolArgs(name, m.Calls)
}
