package roster

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveDefaultsFromProfiles(t *testing.T) {
	set := Resolver{Profiles: []string{"default", "dev", "edu-writer", "zzz-baru"}}.Resolve()
	if len(set.Entries) != 4 {
		t.Fatalf("entries = %d", len(set.Entries))
	}
	// A profile with a seed entry inherits the name/role/team the frontend ships;
	// an unknown profile falls back to its id, the generic role and the dev room.
	want := map[string]Entry{
		"default":    {ID: "default", Name: "Galuh", Role: "ASISTEN UTAMA", Team: "lobby"},
		"dev":        {ID: "dev", Name: "Bima", Role: "SDLC LEAD", Team: "dev"},
		"edu-writer": {ID: "edu-writer", Name: "Yohan", Role: "PENULIS MATERI", Team: "edu"},
		"zzz-baru":   {ID: "zzz-baru", Name: "zzz-baru", Role: GenericRole, Team: "dev"},
	}
	for _, e := range set.Entries {
		if e != want[e.ID] {
			t.Fatalf("%s = %+v, want %+v", e.ID, e, want[e.ID])
		}
	}
	if len(set.Teams) != 3 {
		t.Fatalf("teams = %v", set.Teams)
	}
	labels := map[string]string{}
	for _, tm := range set.Teams {
		if tm.Label == "" {
			t.Fatalf("team %q has no label", tm.ID)
		}
		labels[tm.ID] = tm.Label
	}
	if labels["lobby"] != "Pendopo" || labels["dev"] != "Tim Dev" || labels["edu"] != "Tim Edu" {
		t.Fatalf("team labels = %v", labels)
	}
}

// The default roster must be the one the frontend draws: same ids, names, roles
// and room ids. This parses frontend/src/lib/agents.ts so the two cannot drift.
func TestDefaultAgentsMatchFrontend(t *testing.T) {
	path := filepath.Join("..", "..", "..", "frontend", "src", "lib", "agents.ts")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("frontend source not available: %v", err)
	}
	front := parseFrontendAgents(t, string(raw))
	if len(front) == 0 {
		t.Fatal("parsed 0 agents from agents.ts")
	}
	if len(front) != len(DefaultAgents) {
		t.Fatalf("frontend has %d agents, DefaultAgents has %d", len(front), len(DefaultAgents))
	}
	for _, want := range DefaultAgents {
		got, ok := front[want.ID]
		if !ok {
			t.Fatalf("frontend is missing agent %q", want.ID)
		}
		if got != want {
			t.Fatalf("%s: frontend %+v, DefaultAgents %+v", want.ID, got, want)
		}
	}
}

// parseFrontendAgents reads the AGENTS array with a tiny line scanner: enough
// for `id/name/role/team` inside each object, without a TS parser.
func parseFrontendAgents(t *testing.T, src string) map[string]Entry {
	t.Helper()
	// Only the AGENTS array: the `interface AgentMeta` block and the fallback
	// object in agentMeta() also contain id/name/role/team lines.
	start := strings.Index(src, "export const AGENTS")
	if start < 0 {
		return nil
	}
	src = src[start:]
	if end := strings.Index(src, "\n]"); end > 0 {
		src = src[:end]
	}
	out := map[string]Entry{}
	var cur Entry
	flush := func() {
		if cur.ID != "" {
			out[cur.ID] = cur
		}
		cur = Entry{}
	}
	field := func(line, key string) string {
		marker := key + ":"
		if !strings.HasPrefix(line, marker) {
			return ""
		}
		rest := strings.TrimSpace(line[len(marker):])
		rest = strings.TrimSuffix(rest, ",")
		return strings.Trim(rest, "'\"")
	}
	for _, line := range strings.Split(src, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "{" {
			flush()
			continue
		}
		if v := field(trimmed, "id"); v != "" {
			cur.ID = v
		}
		if v := field(trimmed, "name"); v != "" {
			cur.Name = v
		}
		if v := field(trimmed, "role"); v != "" {
			cur.Role = v
		}
		if v := field(trimmed, "team"); v != "" {
			cur.Team = NormalizeTeam(v)
		}
	}
	flush()
	return out
}

func TestResolveOverrideWins(t *testing.T) {
	doc := &Document{Agents: []Entry{
		{ID: "dev", Name: "Bima", Role: "Lead Dev", Team: "dev"},
		{ID: "edu", Name: "Ayu", Role: "Lead Edu"},
		{ID: "tamu", Name: "Tamu", Role: "Tamu", Team: "pendopo"},
	}}
	set := Resolver{Profiles: []string{"default", "dev", "edu"}, Layers: []*Document{doc}}.Resolve()

	byID := map[string]Entry{}
	for _, e := range set.Entries {
		byID[e.ID] = e
	}
	if byID["dev"].Name != "Bima" || byID["dev"].Role != "Lead Dev" {
		t.Fatalf("dev = %+v", byID["dev"])
	}
	// no team override keeps the inferred room
	if byID["edu"].Team != "edu" {
		t.Fatalf("edu team = %q", byID["edu"].Team)
	}
	// a desk can be added without a profile of its own; the legacy room name
	// `pendopo` is normalised to the id the frontend draws
	if byID["tamu"].Team != "lobby" {
		t.Fatalf("extra desk = %+v", byID["tamu"])
	}
	if got := strings.Join(set.IDs(), ","); got != "default,dev,edu,tamu" {
		t.Fatalf("order = %q", got)
	}
}

func TestResolvePrecedenceFirstWins(t *testing.T) {
	high := &Document{Title: "Tinggi", Agents: []Entry{{ID: "dev", Name: "High"}}}
	low := &Document{Title: "Rendah", TZ: "UTC", Agents: []Entry{{ID: "dev", Name: "Low", Role: "Low Role"}}}
	set := Resolver{Profiles: []string{"dev"}, Layers: []*Document{high, low}}.Resolve()
	if set.Title != "Tinggi" {
		t.Fatalf("title = %q", set.Title)
	}
	if set.TZ != "UTC" {
		t.Fatalf("tz should fall through to the lower layer: %q", set.TZ)
	}
	if set.Entries[0].Name != "High" {
		t.Fatalf("name = %q, want High", set.Entries[0].Name)
	}
	if set.Entries[0].Role != "Low Role" {
		t.Fatalf("role = %q, want the lower layer to fill the gap", set.Entries[0].Role)
	}
}

func TestResolveExtraRanksBelowLayers(t *testing.T) {
	// extra documents model an upstream office: they must not override the
	// local file.
	local := &Document{Agents: []Entry{{ID: "dev", Name: "Lokal"}}}
	upstream := &Document{Agents: []Entry{{ID: "dev", Name: "Remote"}, {ID: "edu", Name: "Ayu"}}}
	set := Resolver{Profiles: []string{"dev"}, Layers: []*Document{local}}.Resolve(upstream)
	byID := map[string]Entry{}
	for _, e := range set.Entries {
		byID[e.ID] = e
	}
	if byID["dev"].Name != "Lokal" {
		t.Fatalf("local override lost: %+v", byID["dev"])
	}
	if byID["edu"].Name != "Ayu" {
		t.Fatalf("upstream desk not inherited: %+v", byID["edu"])
	}
}

func TestParseJSONFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "roster.json")
	body := `{"title":"Kantor Afif","tz":"Asia/Makassar",
		"teams":[{"id":"dev","label":"Ruang Developer"}],
		"agents":[{"id":"dev","name":"Bima","role":"Lead","team":"dev"}]}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	doc, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if doc.Title != "Kantor Afif" || doc.TZ != "Asia/Makassar" {
		t.Fatalf("doc = %+v", doc)
	}
	set := Resolver{Profiles: []string{"dev"}, Layers: []*Document{doc}}.Resolve()
	if set.Teams[0].Label != "Ruang Developer" {
		t.Fatalf("team label = %q", set.Teams[0].Label)
	}
}

func TestParseYAMLFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "roster.yaml")
	body := `# roster kantor
title: Kantor Afif
tz: Asia/Jakarta
teams:
  - id: dev
    label: Ruang Tim Dev
  - id: edu
    label: "Ruang Tim Edu"
agents:
  - id: dev
    name: Bima
    role: Lead Dev
    team: dev
  - id: default
    name: Galuh
`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	doc, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if doc.Title != "Kantor Afif" || doc.TZ != "Asia/Jakarta" {
		t.Fatalf("doc = %+v", doc)
	}
	if len(doc.Agents) != 2 || doc.Agents[0].Name != "Bima" || doc.Agents[1].Name != "Galuh" {
		t.Fatalf("agents = %+v", doc.Agents)
	}
	if len(doc.Teams) != 2 || doc.Teams[1].Label != "Ruang Tim Edu" {
		t.Fatalf("teams = %+v", doc.Teams)
	}

	set := Resolver{Profiles: []string{"default", "dev", "coder"}, Layers: []*Document{doc}}.Resolve()
	byID := map[string]Entry{}
	for _, e := range set.Entries {
		byID[e.ID] = e
	}
	if byID["dev"].Role != "Lead Dev" || byID["default"].Name != "Galuh" {
		t.Fatalf("resolved = %+v", set.Entries)
	}
	// coder is not in the file: the seed entry from DefaultAgents still applies
	if byID["coder"].Name != "Dimas" || byID["coder"].Role != "IMPLEMENTER" {
		t.Fatalf("coder = %+v", byID["coder"])
	}
}

func TestParseYAMLRejectsGarbage(t *testing.T) {
	if _, err := ParseYAML([]byte("agents:\n  - id: dev\n    warna: biru\n")); err == nil {
		t.Fatal("unknown property must be an error, not silently dropped")
	}
	if _, err := ParseYAML([]byte("just some prose\n")); err == nil {
		t.Fatal("non-kv line must be an error")
	}
	if _, err := ParseYAML([]byte("agents:\n\t- id: dev\n")); err == nil {
		t.Fatal("tabs must be rejected")
	}
}

func TestParseJSONRejectsGarbage(t *testing.T) {
	if _, err := ParseJSON([]byte("{not json")); err == nil {
		t.Fatal("expected error")
	}
}

func TestMissingRosterFileIsAnError(t *testing.T) {
	if _, err := LoadFile(filepath.Join(t.TempDir(), "nope.yaml")); err == nil {
		t.Fatal("a path that does not exist must fail loudly")
	}
}

func TestEmptyRosterPathIsNoop(t *testing.T) {
	doc, err := LoadFile("")
	if err != nil || doc != nil {
		t.Fatalf("empty path: doc=%v err=%v", doc, err)
	}
}

func TestMerge(t *testing.T) {
	high := &Document{Title: "A", Agents: []Entry{{ID: "dev", Name: "H"}}}
	low := &Document{Title: "B", TZ: "UTC", Agents: []Entry{{ID: "edu", Name: "L"}}}
	m := Merge(high, low)
	if m.Title != "A" || m.TZ != "UTC" || len(m.Entries()) != 2 {
		t.Fatalf("merged = %+v", m)
	}
	if Merge(nil, low) != low || Merge(high, nil) != high {
		t.Fatal("nil merge should return the other side")
	}
}

func TestRosterFromConfigPayloadShape(t *testing.T) {
	// /api/config emits the desks under "roster"; feeding that back in must work.
	raw := []byte(`{"title":"X","roster":[{"id":"dev","name":"Bima","role":"Lead","team":"dev"}]}`)
	doc, err := ParseJSON(raw)
	if err != nil {
		t.Fatalf("ParseJSON: %v", err)
	}
	if len(doc.Entries()) != 1 || doc.Entries()[0].Name != "Bima" {
		t.Fatalf("entries = %+v", doc.Entries())
	}
}
