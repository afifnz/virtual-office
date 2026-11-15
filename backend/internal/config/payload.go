package config

import (
	"officeapi/internal/roster"
)

// Floor defaults match the room the frontend draws (40 x 30 world units, ~1 m
// each). They are published in /api/config so a client never has to guess.
const (
	DefaultFloorW = 40.0
	DefaultFloorD = 30.0
)

// Layout is the geometry block of /api/config.
type Layout struct {
	Floor Floor `json:"floor"`
}

// Floor is the floor plan size in world units.
type Floor struct {
	W float64 `json:"w"`
	D float64 `json:"d"`
}

// Payload is the GET /api/config response: everything the frontend would
// otherwise hard-code — title, timezone, data source, roster and layout.
type Payload struct {
	Title      string         `json:"title"`
	TZ         string         `json:"tz"`
	Source     string         `json:"source"`
	HermesHome string         `json:"hermes_home"`
	RemoteURL  string         `json:"remote_api_url,omitempty"`
	Profiles   []string       `json:"profiles"`
	Roster     []roster.Entry `json:"roster"`
	Layout     Layout         `json:"layout"`
	Teams      []roster.Team  `json:"teams"`
}

// Build assembles the payload from the resolved config and roster.
func Build(cfg Config, set roster.Set) Payload {
	p := Payload{
		Title:    firstNonEmpty(set.Title, cfg.Title, DefaultTitle),
		TZ:       firstNonEmpty(set.TZ, cfg.TZ, DefaultTZ),
		Source:   firstNonEmpty(cfg.Source, DefaultSource),
		Profiles: set.IDs(),
		Roster:   set.Entries,
		Layout:   Layout{Floor: Floor{W: DefaultFloorW, D: DefaultFloorD}},
		Teams:    set.Teams,
	}
	if !cfg.IsRemote() {
		// Only the local source owns a filesystem; a remote office has its own.
		p.HermesHome = cfg.Home
	} else {
		p.RemoteURL = cfg.RemoteURL
	}
	if p.Profiles == nil {
		p.Profiles = []string{}
	}
	if p.Roster == nil {
		p.Roster = []roster.Entry{}
	}
	if p.Teams == nil {
		p.Teams = []roster.Team{}
	}
	return p
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
