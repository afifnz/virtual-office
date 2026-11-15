// Package roster turns the profiles found on disk into the office roster:
// the desks the frontend draws, with a display name, a role and a team.
//
// The default roster is the one the frontend ships (frontend/src/lib/agents.ts):
// Galuh in the lobby, Bima/Raka/Laras/Dimas/Yoga/Sari in the dev room,
// Ayu/Nisa/Yohan/Hadi in the edu room. A profile with no seed entry is shown
// under its own id with the generic role "Agen". Names, roles and teams can be
// layered in from a JSON/YAML file (OFFICE_ROSTER) or an inline JSON document
// (OFFICE_ROSTER_JSON).
package roster

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

// GenericRole is used for a profile that has no seed entry and no override.
const GenericRole = "Agen"

// Team ids. They are the room ids the frontend draws (frontend/src/lib/rooms.ts),
// so a desk's team is directly a room key — no mapping table in between.
const (
	TeamLobby = "lobby"
	TeamDev   = "dev"
	TeamEdu   = "edu"
)

// DefaultTeams is the label set used when a roster file does not name teams.
// `pendopo` is accepted as an alias for `lobby` in overrides (see NormalizeTeam).
var DefaultTeams = []Team{
	{ID: TeamLobby, Label: "Pendopo"},
	{ID: TeamDev, Label: "Tim Dev"},
	{ID: TeamEdu, Label: "Tim Edu"},
}

// DefaultAgents is the seed roster: the display names and roles the frontend
// ships, so /api/config and the scene agree on every desk. A profile found on
// disk inherits its entry from here; an override still wins field by field.
var DefaultAgents = []Entry{
	{ID: "default", Name: "Galuh", Role: "ASISTEN UTAMA", Team: TeamLobby},
	{ID: "dev", Name: "Bima", Role: "SDLC LEAD", Team: TeamDev},
	{ID: "planner", Name: "Raka", Role: "ANALIS & ARSITEK", Team: TeamDev},
	{ID: "uiux", Name: "Laras", Role: "UI/UX DESIGNER", Team: TeamDev},
	{ID: "coder", Name: "Dimas", Role: "IMPLEMENTER", Team: TeamDev},
	{ID: "reviewer", Name: "Yoga", Role: "CODE REVIEW", Team: TeamDev},
	{ID: "tester", Name: "Sari", Role: "QA", Team: TeamDev},
	{ID: "edu", Name: "Ayu", Role: "EDU LEAD", Team: TeamEdu},
	{ID: "edu-designer", Name: "Nisa", Role: "DESAIN INSTRUKSIONAL", Team: TeamEdu},
	{ID: "edu-writer", Name: "Yohan", Role: "PENULIS MATERI", Team: TeamEdu},
	{ID: "edu-reviewer", Name: "Hadi", Role: "QA MATERI", Team: TeamEdu},
}

var seedByID = func() map[string]Entry {
	m := make(map[string]Entry, len(DefaultAgents))
	for _, e := range DefaultAgents {
		m[e.ID] = e
	}
	return m
}()

// idPattern is the only shape a desk id may have. The id becomes a directory
// name under $HERMES_HOME/profiles and part of a SQLite DSN, so anything that
// could escape that directory (`../..`, a slash, a NUL) is rejected up front.
var idPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// ValidID reports whether s is a safe desk id.
func ValidID(s string) bool { return idPattern.MatchString(s) }

// ValidateID returns a descriptive error for an unsafe desk id.
func ValidateID(s string) error {
	if s == "" {
		return fmt.Errorf("id roster kosong")
	}
	if !ValidID(s) {
		return fmt.Errorf("id roster %q tidak valid: hanya huruf, angka, '-' dan '_' (^[a-zA-Z0-9_-]+$)", s)
	}
	return nil
}

// NormalizeTeam maps the legacy room name to the id the frontend uses.
func NormalizeTeam(team string) string {
	team = strings.TrimSpace(team)
	if strings.EqualFold(team, "pendopo") {
		return TeamLobby
	}
	return team
}

// Entry is one desk.
type Entry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
	Team string `json:"team"`
}

// Team is a room the desks are grouped into.
type Team struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Document is the roster override file format. Both `agents` and `roster` are
// accepted as the list key so an /api/config payload can be fed back in as an
// override file.
type Document struct {
	Title  string  `json:"title"`
	TZ     string  `json:"tz"`
	Agents []Entry `json:"agents"`
	Roster []Entry `json:"roster"`
	Teams  []Team  `json:"teams"`
}

// Entries returns the agent list, preferring `agents` over `roster`.
func (d *Document) Entries() []Entry {
	if d == nil {
		return nil
	}
	if len(d.Agents) > 0 {
		return d.Agents
	}
	return d.Roster
}

// Validate rejects a document that could not be resolved safely.
func (d *Document) Validate() error {
	if d == nil {
		return nil
	}
	for i, e := range d.Entries() {
		if err := ValidateID(strings.TrimSpace(e.ID)); err != nil {
			return fmt.Errorf("agents[%d]: %w", i, err)
		}
	}
	for i, t := range d.Teams {
		id := NormalizeTeam(t.ID)
		if id == "" {
			return fmt.Errorf("teams[%d]: id kosong", i)
		}
		if !ValidID(id) {
			return fmt.Errorf("teams[%d]: id %q tidak valid (^[a-zA-Z0-9_-]+$)", i, t.ID)
		}
	}
	return nil
}

// Set is a resolved roster.
type Set struct {
	Title   string
	TZ      string
	Entries []Entry
	Teams   []Team
}

// IDs returns the desk ids in order.
func (s Set) IDs() []string {
	out := make([]string, 0, len(s.Entries))
	for _, e := range s.Entries {
		out = append(out, e.ID)
	}
	return out
}

// Resolver builds a Set from the discovered profiles plus ordered overrides.
// Layers are listed highest precedence first.
type Resolver struct {
	Profiles []string
	Layers   []*Document
}

// slot tracks which fields an override has already decided, so the seed entry
// (or the profile id) only fills the gaps.
type slot struct {
	entry                     Entry
	nameSet, roleSet, teamSet bool
}

// Resolve applies the layers. extra documents are appended after the
// configured layers, so they rank below them (used to inherit the roster of a
// remote office without overriding a local file).
func (r Resolver) Resolve(extra ...*Document) Set {
	slots := map[string]*slot{}
	order := make([]string, 0, len(r.Profiles))

	ensure := func(id string) *slot {
		if s, ok := slots[id]; ok {
			return s
		}
		e := Entry{ID: id, Name: id, Role: GenericRole, Team: defaultTeam(id)}
		if seed, ok := seedByID[id]; ok {
			e = seed
		}
		s := &slot{entry: e}
		slots[id] = s
		order = append(order, id)
		return s
	}

	// 1. base desks: every profile gets one, seeded from DefaultAgents.
	for _, p := range r.Profiles {
		p = strings.TrimSpace(p)
		if p == "" || !ValidID(p) {
			continue
		}
		ensure(p)
	}

	set := Set{}
	all := make([]*Document, 0, len(r.Layers)+len(extra))
	all = append(all, r.Layers...)
	all = append(all, extra...)
	for _, doc := range all {
		if doc == nil {
			continue
		}
		if set.Title == "" {
			set.Title = strings.TrimSpace(doc.Title)
		}
		if set.TZ == "" {
			set.TZ = strings.TrimSpace(doc.TZ)
		}
		for _, in := range doc.Entries() {
			id := strings.TrimSpace(in.ID)
			if id == "" || !ValidID(id) {
				continue
			}
			s := ensure(id)
			if !s.nameSet {
				if n := strings.TrimSpace(in.Name); n != "" {
					s.entry.Name, s.nameSet = n, true
				}
			}
			if !s.roleSet {
				if role := strings.TrimSpace(in.Role); role != "" {
					s.entry.Role, s.roleSet = role, true
				}
			}
			if !s.teamSet {
				if team := NormalizeTeam(in.Team); team != "" {
					s.entry.Team, s.teamSet = team, true
				}
			}
		}
	}

	for _, id := range order {
		e := slots[id].entry
		if e.Name == "" {
			e.Name = e.ID
		}
		if e.Role == "" {
			e.Role = GenericRole
		}
		if e.Team == "" {
			e.Team = defaultTeam(e.ID)
		}
		set.Entries = append(set.Entries, e)
	}
	if set.Entries == nil {
		set.Entries = []Entry{}
	}

	// 2. teams: labels from the highest layer that names them, else defaults.
	labels := map[string]string{}
	for i := len(all) - 1; i >= 0; i-- { // lowest precedence first, higher overwrites
		if all[i] == nil {
			continue
		}
		for _, t := range all[i].Teams {
			id := NormalizeTeam(t.ID)
			if id == "" {
				continue
			}
			if l := strings.TrimSpace(t.Label); l != "" {
				labels[id] = l
			} else if _, ok := labels[id]; !ok {
				labels[id] = id
			}
		}
	}
	used := map[string]bool{}
	for _, e := range set.Entries {
		if !used[e.Team] {
			used[e.Team] = true
			label := labels[e.Team]
			if label == "" {
				label = defaultTeamLabel(e.Team)
			}
			set.Teams = append(set.Teams, Team{ID: e.Team, Label: label})
		}
	}
	if set.Teams == nil {
		set.Teams = []Team{}
	}
	return set
}

// defaultTeam maps a profile id to a room. `default` sits in the lobby, the
// edu-* family in the edu room, everything else in the dev room.
func defaultTeam(id string) string {
	low := strings.ToLower(id)
	switch {
	case low == "default" || low == "lobby" || low == "pendopo":
		return TeamLobby
	case low == "edu" || strings.HasPrefix(low, "edu-"):
		return TeamEdu
	default:
		return TeamDev
	}
}

func defaultTeamLabel(team string) string {
	for _, t := range DefaultTeams {
		if t.ID == team {
			return t.Label
		}
	}
	return team
}

// LoadFile parses a roster override file. The format is chosen by extension
// (.yaml/.yml → YAML subset, everything else → JSON) and falls back to
// sniffing the content.
func LoadFile(path string) (*Document, error) {
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("baca roster %s: %w", path, err)
	}
	low := strings.ToLower(path)
	if strings.HasSuffix(low, ".yaml") || strings.HasSuffix(low, ".yml") {
		return ParseYAML(raw)
	}
	if strings.HasSuffix(low, ".json") {
		return ParseJSON(raw)
	}
	if trimmed := strings.TrimSpace(string(raw)); strings.HasPrefix(trimmed, "{") {
		return ParseJSON(raw)
	}
	return ParseYAML(raw)
}

// Merge returns a document where the higher-priority fields win. Used to fold
// an inline document over a file document before resolving.
func Merge(high, low *Document) *Document {
	if high == nil {
		return low
	}
	if low == nil {
		return high
	}
	out := *high
	if out.Title == "" {
		out.Title = low.Title
	}
	if out.TZ == "" {
		out.TZ = low.TZ
	}
	out.Agents = append(append([]Entry{}, high.Entries()...), low.Entries()...)
	out.Roster = nil
	out.Teams = append(append([]Team{}, high.Teams...), low.Teams...)
	return &out
}

// SortedIDs is a helper for tests and logs.
func SortedIDs(s Set) []string {
	ids := s.IDs()
	sort.Strings(ids)
	return ids
}
