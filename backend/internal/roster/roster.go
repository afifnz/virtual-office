// Package roster turns the profiles found on disk into the office roster:
// the desks the frontend draws, with a display name, a role and a team.
//
// Everything has a working default — a profile with no override is shown under
// its own id with a generic role — so a fresh Hermes home needs no config file
// at all. Names, roles and teams can be layered in from a JSON/YAML file
// (OFFICE_ROSTER) or an inline JSON document (OFFICE_ROSTER_JSON).
package roster

import (
	"fmt"
	"os"
	"sort"
	"strings"
)

// GenericRole is used for a profile that has no override.
const GenericRole = "Agen"

// DefaultTeams is the label set used when a roster file does not name teams.
// The ids match the rooms the frontend draws.
var DefaultTeams = []Team{
	{ID: "pendopo", Label: "Pendopo"},
	{ID: "dev", Label: "Ruang Tim Dev"},
	{ID: "edu", Label: "Ruang Tim Edu"},
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

// Resolve applies the layers. extra documents are appended after the
// configured layers, so they rank below them (used to inherit the roster of a
// remote office without overriding a local file).
func (r Resolver) Resolve(extra ...*Document) Set {
	byID := map[string]int{}
	set := Set{Entries: []Entry{}}

	add := func(e Entry) int {
		if i, ok := byID[e.ID]; ok {
			return i
		}
		byID[e.ID] = len(set.Entries)
		set.Entries = append(set.Entries, Entry{ID: e.ID})
		return len(set.Entries) - 1
	}

	// 1. base desks: every profile gets one, named after itself.
	for _, p := range r.Profiles {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		i := add(Entry{ID: p})
		set.Entries[i] = Entry{ID: p, Name: p, Role: GenericRole, Team: defaultTeam(p)}
	}

	// 2. overrides, highest precedence first; first writer wins per field.
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
			if id == "" {
				continue
			}
			i := add(Entry{ID: id})
			cur := set.Entries[i]
			if cur.Name == "" || cur.Name == id {
				if n := strings.TrimSpace(in.Name); n != "" {
					cur.Name = n
				}
			}
			if (cur.Role == "" || cur.Role == GenericRole) && strings.TrimSpace(in.Role) != "" {
				cur.Role = strings.TrimSpace(in.Role)
			}
			if strings.TrimSpace(in.Team) != "" && (cur.Team == "" || cur.Team == defaultTeam(id)) {
				cur.Team = strings.TrimSpace(in.Team)
			}
			if cur.Name == "" {
				cur.Name = id
			}
			if cur.Role == "" {
				cur.Role = GenericRole
			}
			if cur.Team == "" {
				cur.Team = defaultTeam(id)
			}
			set.Entries[i] = cur
		}
	}

	for i, e := range set.Entries {
		if e.Name == "" {
			set.Entries[i].Name = e.ID
		}
		if e.Role == "" {
			set.Entries[i].Role = GenericRole
		}
		if e.Team == "" {
			set.Entries[i].Team = defaultTeam(e.ID)
		}
	}

	// 3. teams: labels from the highest layer that names them, else defaults.
	labels := map[string]string{}
	for i := len(all) - 1; i >= 0; i-- { // lowest precedence first, higher overwrites
		if all[i] == nil {
			continue
		}
		for _, t := range all[i].Teams {
			id := strings.TrimSpace(t.ID)
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

// defaultTeam maps a profile id to a room. `default` sits in the pendopo, the
// edu-* family in the edu room, everything else in the dev room.
func defaultTeam(id string) string {
	low := strings.ToLower(id)
	switch {
	case low == "default" || low == "pendopo":
		return "pendopo"
	case low == "edu" || strings.HasPrefix(low, "edu-"):
		return "edu"
	default:
		return "dev"
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
