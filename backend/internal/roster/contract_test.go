package roster

import (
	"strings"
	"testing"
)

// Hand-written YAML puts the dash at column 0 under its key. That must parse.
func TestParseYAMLDashAtColumnZero(t *testing.T) {
	body := `title: Kantor
tz: Asia/Jakarta
teams:
- id: lobby
  label: Pendopo
agents:
- id: dev
  name: Bima
  role: SDLC LEAD
  team: dev
- id: coder
  name: Dimas
`
	doc, err := ParseYAML([]byte(body))
	if err != nil {
		t.Fatalf("ParseYAML: %v", err)
	}
	if doc.Title != "Kantor" || doc.TZ != "Asia/Jakarta" {
		t.Fatalf("doc = %+v", doc)
	}
	if len(doc.Agents) != 2 {
		t.Fatalf("agents = %+v", doc.Agents)
	}
	if doc.Agents[0].ID != "dev" || doc.Agents[0].Name != "Bima" || doc.Agents[0].Team != "dev" {
		t.Fatalf("agents[0] = %+v", doc.Agents[0])
	}
	if doc.Agents[1].ID != "coder" || doc.Agents[1].Role != "" {
		t.Fatalf("agents[1] = %+v", doc.Agents[1])
	}
	if len(doc.Teams) != 1 || doc.Teams[0].Label != "Pendopo" {
		t.Fatalf("teams = %+v", doc.Teams)
	}
}

// Mixed indentation (dash at 0, properties at 2) is what the README shows.
func TestParseYAMLMixedIndent(t *testing.T) {
	body := "agents:\n  - id: dev\n    name: Bima\n- id: edu\n  name: Ayu\n"
	doc, err := ParseYAML([]byte(body))
	if err != nil {
		t.Fatalf("ParseYAML: %v", err)
	}
	if len(doc.Agents) != 2 || doc.Agents[0].Name != "Bima" || doc.Agents[1].Name != "Ayu" {
		t.Fatalf("agents = %+v", doc.Agents)
	}
}

// `agents: []` is the flow form of an empty list, not a syntax error.
func TestParseYAMLFlowEmptyList(t *testing.T) {
	for _, body := range []string{
		"title: X\nagents: []\n",
		"title: X\nagents: [ ]\n",
		"title: X\nagents: []\nteams: []\n",
	} {
		doc, err := ParseYAML([]byte(body))
		if err != nil {
			t.Fatalf("%q: %v", body, err)
		}
		if len(doc.Agents) != 0 {
			t.Fatalf("%q: agents = %+v", body, doc.Agents)
		}
	}
	// A non-empty flow list is still unsupported, and says so clearly.
	if _, err := ParseYAML([]byte("agents: [dev, edu]\n")); err == nil {
		t.Fatal("flow list with items should be rejected, not guessed")
	}
}

// A scalar key ends the list, so a stray item after `tz:` is an error.
func TestParseYAMLStrayItemAfterScalar(t *testing.T) {
	body := "agents:\n- id: dev\ntz: Asia/Jakarta\n- id: edu\n"
	if _, err := ParseYAML([]byte(body)); err == nil {
		t.Fatal("a list item after a scalar key must be rejected")
	}
}

func TestValidID(t *testing.T) {
	for _, ok := range []string{"default", "dev", "edu-writer", "a_b", "A9", "x"} {
		if !ValidID(ok) {
			t.Fatalf("%q rejected", ok)
		}
	}
	for _, bad := range []string{"", "../x", "a/b", "..", ".", "a b", "a.b", "id;drop", "ñ"} {
		if ValidID(bad) {
			t.Fatalf("%q accepted", bad)
		}
	}
}

// The whole point: a roster file must not be able to reach outside
// $HERMES_HOME/profiles with a crafted id.
func TestValidateRejectsPathTraversal(t *testing.T) {
	doc := &Document{Agents: []Entry{
		{ID: "../../../../tmp/leak", Name: "Leak"},
	}}
	if err := doc.Validate(); err == nil {
		t.Fatal("traversal id accepted")
	}
	if err := doc.Validate(); err != nil && !strings.Contains(err.Error(), "tidak valid") {
		t.Fatalf("unhelpful error: %v", err)
	}

	good := &Document{Agents: []Entry{{ID: "dev", Name: "Bima"}}}
	if err := good.Validate(); err != nil {
		t.Fatalf("valid doc rejected: %v", err)
	}
	var nilDoc *Document
	if err := nilDoc.Validate(); err != nil {
		t.Fatalf("nil doc: %v", err)
	}
}

// Even if a caller skips Validate, Resolve must not emit an unsafe id: the id
// ends up in a filesystem path and a SQLite DSN.
func TestResolveDropsUnsafeIDs(t *testing.T) {
	doc := &Document{Agents: []Entry{
		{ID: "../../../../tmp/leak", Name: "Leak"},
		{ID: "dev", Name: "Bima"},
	}}
	set := Resolver{Profiles: []string{"dev", "../../etc"}, Layers: []*Document{doc}}.Resolve()
	for _, e := range set.Entries {
		if !ValidID(e.ID) {
			t.Fatalf("unsafe id reached the roster: %q", e.ID)
		}
	}
	if len(set.Entries) != 1 || set.Entries[0].ID != "dev" {
		t.Fatalf("entries = %+v", set.Entries)
	}
}

// The legacy room name is accepted so an old roster file keeps working.
func TestNormalizeTeamAlias(t *testing.T) {
	if got := NormalizeTeam("pendopo"); got != TeamLobby {
		t.Fatalf("pendopo -> %q", got)
	}
	if got := NormalizeTeam("Pendopo"); got != TeamLobby {
		t.Fatalf("Pendopo -> %q", got)
	}
	if got := NormalizeTeam("dev"); got != "dev" {
		t.Fatalf("dev -> %q", got)
	}
}

// An override that only sets a name must not lose the seeded role/team.
func TestOverrideIsFieldWise(t *testing.T) {
	doc := &Document{Agents: []Entry{{ID: "default", Name: "Galuh Afif"}}}
	set := Resolver{Profiles: []string{"default"}, Layers: []*Document{doc}}.Resolve()
	if len(set.Entries) != 1 {
		t.Fatalf("entries = %+v", set.Entries)
	}
	e := set.Entries[0]
	if e.Name != "Galuh Afif" {
		t.Fatalf("name = %q", e.Name)
	}
	if e.Role != "ASISTEN UTAMA" || e.Team != TeamLobby {
		t.Fatalf("seed lost: %+v", e)
	}
}
